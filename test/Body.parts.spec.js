"use strict";

// Fixed sample MJ-D:
// a square main body of mass 2 centred at (0, 0), a new circle part of mass 3
// centred at (2.5, 0) and an original velocity of (0.3, 0).
// Replacing parts must hand over mass, inertia, bounds and velocity in one step.

const Matter = require('../src/module/main');

const { Bodies, Body } = Matter;

const SQUARE_SIZE = 40;
const CIRCLE_RADIUS = 1;
const EPSILON = 1e-9;

const expectClose = (actual, expected, epsilon = EPSILON) => {
    expect(Math.abs(actual - expected)).toBeLessThanOrEqual(epsilon);
};

const expectVectorClose = (actual, expected, epsilon = EPSILON) => {
    expectClose(actual.x, expected.x, epsilon);
    expectClose(actual.y, expected.y, epsilon);
};

// builds the MJ-D compound: square (mass 2) + initial circle part (mass 1), total mass 3
const createSample = () => {
    const square = Bodies.rectangle(0, 0, SQUARE_SIZE, SQUARE_SIZE, { mass: 2 });
    const oldCircle = Bodies.circle(2.5, 0, CIRCLE_RADIUS, { mass: 1 });
    const body = Body.create({ parts: [square, oldCircle] });
    Body.setVelocity(body, { x: 0.3, y: 0 });
    return { body, square, oldCircle };
};

describe('MJ-D compound part replacement', () => {
    test('replaces a part and hands over mass, centre of mass, bounds and velocity atomically', () => {
        const { body, square, oldCircle } = createSample();
        const newCircle = Bodies.circle(2.5, 0, CIRCLE_RADIUS, { mass: 3 });

        expect(body.mass).toBe(3);
        const leftBoundBefore = body.bounds.min.x;
        expectVectorClose(Body.getVelocity(body), { x: 0.3, y: 0 });

        const result = Body.replacePart(body, oldCircle, newCircle);

        expect(result).toBe(true);

        // mass goes from 3 to 5
        expectClose(body.mass, 5);

        // centre of mass moves to (1.5, 0): (2 * 0 + 3 * 2.5) / 5
        expectVectorClose(body.position, { x: 1.5, y: 0 });

        // the original velocity is carried over
        expectVectorClose(Body.getVelocity(body), { x: 0.3, y: 0 });

        // the left world bound stays where it was
        expectClose(body.bounds.min.x, leftBoundBefore);

        // the parts were actually swapped
        const childParts = body.parts.slice(1);
        expect(childParts.length).toBe(2);
        expect(childParts[0]).toBe(square);
        expect(childParts[1]).toBe(newCircle);
        expect(newCircle.parent).toBe(body);

        // the remaining parts stay fixed in world space
        expectVectorClose(square.position, { x: 0, y: 0 });
        expectVectorClose(newCircle.position, { x: 2.5, y: 0 });
        expectClose(Math.min.apply(null, square.vertices.map(vertex => vertex.x)), -SQUARE_SIZE / 2);
        expectClose(Math.max.apply(null, square.vertices.map(vertex => vertex.x)), SQUARE_SIZE / 2);
    });

    test('Body.setParts recombines parts with the same guarantees', () => {
        const { body, square, oldCircle } = createSample();
        const newCircle = Bodies.circle(2.5, 0, CIRCLE_RADIUS, { mass: 3 });

        const leftBoundBefore = body.bounds.min.x;

        Body.setParts(body, [square, newCircle]);

        expectClose(body.mass, 5);
        expectVectorClose(body.position, { x: 1.5, y: 0 });
        expectVectorClose(Body.getVelocity(body), { x: 0.3, y: 0 });
        expectClose(body.bounds.min.x, leftBoundBefore);
        expect(body.parts.slice(1)[1]).toBe(newCircle);
        expect(body.parts.slice(1).indexOf(oldCircle)).toBe(-1);
    });

    test('removing the circle restores the previous (square-only) inertia', () => {
        const { body, square, oldCircle } = createSample();
        const newCircle = Bodies.circle(2.5, 0, CIRCLE_RADIUS, { mass: 3 });
        const squareOnlyInertia = Bodies.rectangle(0, 0, SQUARE_SIZE, SQUARE_SIZE, { mass: 2 }).inertia;

        Body.replacePart(body, oldCircle, newCircle);
        expect(body.inertia).not.toBe(squareOnlyInertia);

        const result = Body.replacePart(body, newCircle, null);

        expect(result).toBe(true);
        // the parent plus the square part remain, the removed circle is gone
        expect(body.parts.length).toBe(2);
        expect(body.parts[0]).toBe(body);
        expect(body.parts[1]).toBe(square);
        expectClose(body.mass, 2);
        expectClose(body.inertia, squareOnlyInertia, 1e-6);
        expectVectorClose(Body.getVelocity(body), { x: 0.3, y: 0 });
    });

    test('add then remove round trip restores the exact original properties', () => {
        const { body, oldCircle } = createSample();
        const newCircle = Bodies.circle(2.5, 0, CIRCLE_RADIUS, { mass: 3 });

        const inertiaBefore = body.inertia;
        const positionBefore = { x: body.position.x, y: body.position.y };
        const leftBoundBefore = body.bounds.min.x;

        Body.replacePart(body, oldCircle, newCircle);
        Body.replacePart(body, newCircle, oldCircle);

        expectClose(body.mass, 3);
        expectClose(body.inertia, inertiaBefore);
        expectVectorClose(body.position, positionBefore);
        expectClose(body.bounds.min.x, leftBoundBefore);
        expectVectorClose(Body.getVelocity(body), { x: 0.3, y: 0 });
        expect(body.parts.slice(1)[1]).toBe(oldCircle);
    });

    test('fails on an invalid circle radius and leaves the old parts unchanged', () => {
        const { body, square, oldCircle } = createSample();

        const invalidCircle = Bodies.circle(2.5, 0, CIRCLE_RADIUS, { mass: 3 });
        invalidCircle.circleRadius = -1;

        const snapshot = {
            parts: body.parts.slice(),
            mass: body.mass,
            inertia: body.inertia,
            position: { x: body.position.x, y: body.position.y },
            velocity: Body.getVelocity(body),
            boundsMin: { x: body.bounds.min.x, y: body.bounds.min.y }
        };

        const warn = jest.spyOn(Matter.Common, 'warn').mockImplementation(() => {});
        const result = Body.replacePart(body, oldCircle, invalidCircle);
        warn.mockRestore();

        expect(result).toBe(false);
        expect(body.parts.length).toBe(snapshot.parts.length);
        expect(body.parts[0]).toBe(snapshot.parts[0]);
        expect(body.parts[1]).toBe(square);
        expect(body.parts[2]).toBe(oldCircle);
        expect(body.mass).toBe(snapshot.mass);
        expect(body.inertia).toBe(snapshot.inertia);
        expectVectorClose(body.position, snapshot.position);
        expectVectorClose(Body.getVelocity(body), snapshot.velocity);
        expectVectorClose(body.bounds.min, snapshot.boundsMin);

        // a NaN radius is rejected the same way
        const nanCircle = Bodies.circle(2.5, 0, CIRCLE_RADIUS, { mass: 3 });
        nanCircle.circleRadius = NaN;

        const nanWarn = jest.spyOn(Matter.Common, 'warn').mockImplementation(() => {});
        expect(Body.replacePart(body, oldCircle, nanCircle)).toBe(false);
        nanWarn.mockRestore();

        expect(body.parts[1]).toBe(square);
        expect(body.parts[2]).toBe(oldCircle);
    });

    test('fails when the old part is not part of the body and changes nothing', () => {
        const { body, square, oldCircle } = createSample();
        const unrelated = Bodies.circle(2.5, 0, CIRCLE_RADIUS, { mass: 3 });
        const partsBefore = body.parts.slice();

        const warn = jest.spyOn(Matter.Common, 'warn').mockImplementation(() => {});
        const result = Body.replacePart(body, unrelated, unrelated);
        warn.mockRestore();

        expect(result).toBe(false);
        expect(body.parts.length).toBe(partsBefore.length);
        expect(body.parts[0]).toBe(partsBefore[0]);
        expect(body.parts[1]).toBe(square);
        expect(body.parts[2]).toBe(oldCircle);
        expectClose(body.mass, 3);
    });

    test('accepts a non-circle replacement part', () => {
        const { body, oldCircle } = createSample();
        const replacement = Bodies.rectangle(2.5, 0, 10, 10, { mass: 4 });

        const result = Body.replacePart(body, oldCircle, replacement);

        expect(result).toBe(true);
        expectClose(body.mass, 6);
        expect(body.parts.slice(1)[1]).toBe(replacement);
        expectVectorClose(Body.getVelocity(body), { x: 0.3, y: 0 });
    });
});
