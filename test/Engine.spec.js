"use strict";

jest.setTimeout(30 * 1000);

const Matter = require('../src/module/main');
const { Engine, Bodies, Body, Composite, Events, Query, Pair } = Matter;

/**
 * Fixed sample MJ-A:
 *
 * A radius 10 ball moving at 4 pixels per step hits a static wall. Inside the
 * `collisionStart` handler the wall is removed from the world, then two more
 * steps run.
 *
 * After the removal the current step must not emit any further Active event
 * for the removed pair, the next query must not return the stale pair and the
 * pair cache / detector must no longer reference the removed body either.
 *
 * Two unrelated balls still produce exactly one collisionStart, repeating the
 * whole round produces the same event sequence and deleting the wall must not
 * change the velocity of any other body.
 */
const createMjaEngine = function() {
    const engine = Engine.create();
    engine.gravity.y = 0;

    // radius 10 ball travelling 4 pixels per step into a static wall
    const ball = Bodies.circle(100, 100, 10, {
        friction: 0,
        frictionStatic: 0,
        restitution: 0
    });
    Body.setVelocity(ball, { x: 4, y: 0 });

    const wall = Bodies.rectangle(120, 100, 20, 200, { isStatic: true });

    // two unrelated balls already within contact distance
    const ballA = Bodies.circle(300, 100, 10, { friction: 0, restitution: 0 });
    const ballB = Bodies.circle(315, 100, 10, { friction: 0, restitution: 0 });
    Body.setVelocity(ballA, { x: 4, y: 0 });
    Body.setVelocity(ballB, { x: -4, y: 0 });

    Composite.add(engine.world, [ball, wall, ballA, ballB]);

    return { engine, ball, wall, ballA, ballB };
};

const recordEvents = function(engine) {
    const events = [];

    Events.on(engine, 'collisionStart', event => {
        for (const pair of event.pairs) {
            events.push({ type: 'start', id: pair.id });
        }
    });

    Events.on(engine, 'collisionActive', event => {
        for (const pair of event.pairs) {
            events.push({ type: 'active', id: pair.id });
        }
    });

    Events.on(engine, 'collisionEnd', event => {
        for (const pair of event.pairs) {
            events.push({ type: 'end', id: pair.id });
        }
    });

    return events;
};

const pairIds = function(pairs) {
    return pairs.map(pair => pair.id).sort();
};

const queryPairIds = function(body, bodies) {
    return Query.collides(body, bodies)
        .map(collision => Pair.id(collision.bodyA, collision.bodyB))
        .sort();
};

describe('Engine hot body removal (sample MJ-A)', () => {
    test('removing a body in collisionStart prevents further events and stale pairs in the same step', () => {
        const { engine, ball, wall } = createMjaEngine();
        const events = recordEvents(engine);

        let wallPairId = null;

        Events.on(engine, 'collisionStart', event => {
            for (const pair of event.pairs) {
                if (pair.bodyA === wall || pair.bodyB === wall) {
                    wallPairId = pair.id;
                    Composite.remove(engine.world, wall);
                }
            }
        });

        // step 1: the ball hits the wall, the handler removes the wall
        Engine.update(engine, 16.666);

        expect(wallPairId).not.toBeNull();

        // the wall must be gone from the world
        expect(Composite.allBodies(engine.world)).not.toContain(wall);

        // no Active event may be emitted in the removal step for the removed pair
        const sameStepEvents = events
            .filter(event => event.type !== 'start' || event.id !== wallPairId);

        expect(sameStepEvents.some(event => event.id === wallPairId)).toBe(false);

        // the pair cache must no longer hold the removed pair
        expect(pairIds(engine.pairs.list)).not.toContain(wallPairId);
        expect(Object.keys(engine.pairs.table)).not.toContain(wallPairId);
        expect(engine.pairs.collisionActive.some(pair => pair.id === wallPairId)).toBe(false);
        expect(engine.pairs.collisionEnd.some(pair => pair.id === wallPairId)).toBe(false);

        // the detector must no longer reference the removed body
        expect(engine.detector.bodies).not.toContain(wall);

        // a world query in the same step must not return the stale pair
        expect(queryPairIds(ball, Composite.allBodies(engine.world)))
            .not.toContain(wallPairId);

        // run two more steps as specified by the sample
        Engine.update(engine, 16.666);
        Engine.update(engine, 16.666);

        // the removed pair never reappears in events, cache or queries
        expect(events.some(event => event.id === wallPairId && event.type !== 'start')).toBe(false);
        expect(pairIds(engine.pairs.list)).not.toContain(wallPairId);
        expect(Object.keys(engine.pairs.table)).not.toContain(wallPairId);
        expect(engine.detector.bodies).not.toContain(wall);
        expect(queryPairIds(ball, Composite.allBodies(engine.world)))
            .not.toContain(wallPairId);
    });

    test('unrelated bodies still produce exactly one collisionStart', () => {
        const { engine, ballA, ballB } = createMjaEngine();
        const events = recordEvents(engine);
        const unrelatedPairId = Pair.id(ballA, ballB);

        Engine.update(engine, 16.666);
        Engine.update(engine, 16.666);
        Engine.update(engine, 16.666);

        const starts = events.filter(event =>
            event.type === 'start' && event.id === unrelatedPairId);

        expect(starts.length).toBe(1);
    });

    test('repeating the round produces an identical event ID sequence', () => {
        const runRound = function() {
            const setup = createMjaEngine();
            const engine = setup.engine;
            const events = recordEvents(engine);

            Events.on(engine, 'collisionStart', event => {
                for (const pair of event.pairs) {
                    if (pair.bodyA === setup.wall || pair.bodyB === setup.wall) {
                        Composite.remove(engine.world, setup.wall);
                    }
                }
            });

            for (let step = 0; step < 3; step++) {
                Engine.update(engine, 16.666);
            }

            // normalise the per-round sequential ids into their creation order
            const idOrder = {};
            let nextOrder = 0;

            return events.map(event => {
                if (typeof idOrder[event.id] === 'undefined') {
                    idOrder[event.id] = nextOrder++;
                }

                return event.type + ':' + idOrder[event.id];
            });
        };

        const round1 = runRound();
        const round2 = runRound();

        expect(round2).toEqual(round1);
    });

    test('removing a body does not change the velocity of any other body', () => {
        const run = function(removeWall) {
            const setup = createMjaEngine();
            const engine = setup.engine;

            if (removeWall) {
                Events.on(engine, 'collisionStart', event => {
                    for (const pair of event.pairs) {
                        if (pair.bodyA === setup.wall || pair.bodyB === setup.wall) {
                            Composite.remove(engine.world, setup.wall);
                        }
                    }
                });
            }

            Engine.update(engine, 16.666);
            Engine.update(engine, 16.666);
            Engine.update(engine, 16.666);

            // only bodies unrelated to the removed wall are compared,
            // the colliding ball itself is intentionally excluded
            return {
                ballA: { x: setup.ballA.velocity.x, y: setup.ballA.velocity.y },
                ballB: { x: setup.ballB.velocity.x, y: setup.ballB.velocity.y },
                ballAPosition: { x: setup.ballA.position.x, y: setup.ballA.position.y },
                ballBPosition: { x: setup.ballB.position.x, y: setup.ballB.position.y }
            };
        };

        expect(run(true)).toEqual(run(false));
    });

    test('Pairs.removeBody clears all references to a removed body', () => {
        const { engine, ball, wall } = createMjaEngine();
        const wallPairId = Pair.id(ball, wall);

        Engine.update(engine, 16.666);

        expect(engine.pairs.list.some(pair => pair.id === wallPairId)).toBe(true);
        expect(engine.pairs.table[wallPairId]).toBeDefined();

        Matter.Pairs.removeBody(engine.pairs, wall);

        expect(engine.pairs.list.some(pair => pair.id === wallPairId)).toBe(false);
        expect(engine.pairs.table[wallPairId]).toBeUndefined();
        expect(engine.pairs.collisionStart.some(pair =>
            pair.bodyA === wall || pair.bodyB === wall)).toBe(false);
        expect(engine.pairs.collisionActive.some(pair =>
            pair.bodyA === wall || pair.bodyB === wall)).toBe(false);
        expect(engine.pairs.collisionEnd.some(pair =>
            pair.bodyA === wall || pair.bodyB === wall)).toBe(false);
    });

    test('removing a compound body clears pairs for all of its parts', () => {
        const engine = Engine.create();
        engine.gravity.y = 0;

        const ball = Bodies.circle(100, 100, 10, { friction: 0, restitution: 0 });
        Body.setVelocity(ball, { x: 4, y: 0 });

        const partA = Bodies.rectangle(120, 95, 20, 10, { isStatic: true });
        const partB = Bodies.rectangle(120, 105, 20, 10, { isStatic: true });
        const compound = Body.create({ parts: [partA, partB], isStatic: true });

        Composite.add(engine.world, [ball, compound]);

        Events.on(engine, 'collisionStart', () => {
            Composite.remove(engine.world, compound);
        });

        Engine.update(engine, 16.666);

        expect(engine.pairs.list.length).toBe(0);
        expect(Object.keys(engine.pairs.table).length).toBe(0);
        expect(engine.detector.bodies).not.toContain(compound);
        expect(Composite.allBodies(engine.world)).not.toContain(compound);
    });
});
