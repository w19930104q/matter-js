/* eslint-env es6 */
"use strict";

const Engine = require('../src/core/Engine');
const Events = require('../src/core/Events');
const Bodies = require('../src/factory/Bodies');
const Composite = require('../src/body/Composite');
const FixedStepSimulator = require('../src/core/FixedStepSimulator');

// fixed sample MJ-C: target step 16.6667 ms, frame intervals 16.7, 33.4, 8.3, 16.7 ms
const MJC_DELTA = 16.6667;
const MJC_FRAME_TIMES = [16.7, 50.1, 58.4, 75.1];

const createScene = () => {
    const engine = Engine.create();
    engine.gravity.x = 0;
    engine.gravity.y = 0;

    // moves exactly +1 in x per fixed step, starting from (-1, 0):
    // a constant delta makes the engine time correction exactly 1
    const body = Bodies.rectangle(-1, 0, 10, 10, { frictionAir: 0 });
    body.deltaTime = MJC_DELTA;
    body.positionPrev.x = body.position.x - 1;
    body.positionPrev.y = body.position.y;
    Composite.add(engine.world, body);

    const simulator = FixedStepSimulator.create({ delta: MJC_DELTA });

    return { engine, simulator, body };
};

const snapshot = engine => Composite.allBodies(engine.world).map(body => [
    body.position.x, body.position.y,
    body.velocity.x, body.velocity.y,
    body.angle, body.angularVelocity
]);

describe('FixedStepSimulator', () => {
    test('replays fixed sample MJ-C as 4 fixed steps', () => {
        const { engine, simulator, body } = createScene();

        const positions = [];
        Events.on(simulator, 'afterStep', () => {
            positions.push([body.position.x, body.position.y]);
        });

        for (const time of MJC_FRAME_TIMES) {
            FixedStepSimulator.tick(simulator, engine, time);
        }

        // frame intervals 16.7, 33.4, 8.3, 16.7 ms give 1, 2, 0, 1 steps
        expect(positions.length).toBe(4);
        const expected = [[0, 0], [1, 0], [2, 0], [3, 0]];
        positions.forEach(([x, y], i) => {
            expect(x).toBeCloseTo(expected[i][0], 6);
            expect(y).toBeCloseTo(expected[i][1], 6);
        });
    });

    test('accumulated time does not change while paused', () => {
        const { engine, simulator } = createScene();

        FixedStepSimulator.tick(simulator, engine, 16.7);
        FixedStepSimulator.pause(simulator);

        const accumulator = simulator.accumulator;
        const time = simulator.time;
        const stepCount = simulator.stepCount;

        // ticks during the pause must not accumulate time or perform steps
        FixedStepSimulator.tick(simulator, engine, 50.1);
        FixedStepSimulator.tick(simulator, engine, 1050.1);

        expect(simulator.accumulator).toBe(accumulator);
        expect(simulator.time).toBe(time);
        expect(simulator.stepCount).toBe(stepCount);
    });

    test('resume does not accumulate the time spent paused', () => {
        const { engine, simulator } = createScene();

        FixedStepSimulator.tick(simulator, engine, 16.7);
        FixedStepSimulator.pause(simulator);
        FixedStepSimulator.tick(simulator, engine, 5016.7);
        FixedStepSimulator.resume(simulator);

        // only the post-resume frame delta is simulated, not the paused gap
        const steps = FixedStepSimulator.tick(simulator, engine, 5016.7 + 16.7);
        expect(steps).toBe(1);
        expect(simulator.stepCount).toBe(2);
    });

    test('interpolation alpha only affects draw coordinates, never physics state', () => {
        const { engine, simulator, body } = createScene();

        FixedStepSimulator.tick(simulator, engine, 16.7);
        FixedStepSimulator.tick(simulator, engine, 25.0);

        const alpha = FixedStepSimulator.getInterpolationAlpha(simulator);
        expect(alpha).toBeGreaterThan(0);
        expect(alpha).toBeLessThan(1);

        const before = JSON.stringify(snapshot(engine));
        const positionPrev = { x: body.positionPrev.x, y: body.positionPrev.y };

        const draw = FixedStepSimulator.interpolatePosition(body, alpha);

        // draw coordinates lie between the previous and current physics positions
        expect(draw.x).toBeCloseTo(positionPrev.x + (body.position.x - positionPrev.x) * alpha, 10);
        expect(draw.y).toBeCloseTo(positionPrev.y + (body.position.y - positionPrev.y) * alpha, 10);

        // reading interpolation must not write any physics state
        expect(body.positionPrev.x).toBe(positionPrev.x);
        expect(body.positionPrev.y).toBe(positionPrev.y);
        expect(JSON.stringify(snapshot(engine))).toBe(before);
    });

    test('two identical replays produce identical physics snapshots', () => {
        const replay = () => {
            const { engine, simulator, body } = createScene();
            const frames = [16.7, 33.4, 25.0, 58.4, 75.1, 325.1, 341.8, 400.0];

            for (const time of frames) {
                if (time === 58.4) {
                    FixedStepSimulator.pause(simulator);
                }
                if (time === 75.1) {
                    FixedStepSimulator.resume(simulator);
                }
                FixedStepSimulator.tick(simulator, engine, time);

                // sampling interpolation must not influence the physics outcome
                FixedStepSimulator.interpolatePosition(body, simulator.alpha);
            }

            return JSON.stringify(snapshot(engine));
        };

        expect(replay()).toBe(replay());
    });

    test('a single frame over 100 ms catches up at most 6 steps', () => {
        const { engine, simulator } = createScene();

        FixedStepSimulator.tick(simulator, engine, 16.7);
        const steps = FixedStepSimulator.tick(simulator, engine, 16.7 + 5000);

        expect(steps).toBe(6);
        expect(simulator.lastStepCount).toBe(6);
        // the excess time is discarded, not carried into later frames
        expect(simulator.accumulator).toBeLessThan(MJC_DELTA);
    });

    test('caps steps per tick at maxStepsPerFrame', () => {
        const { engine, simulator } = createScene();
        simulator.accumulator = 10 * MJC_DELTA;

        const steps = FixedStepSimulator.tick(simulator, engine, 16.7);

        expect(steps).toBe(6);
    });
});
