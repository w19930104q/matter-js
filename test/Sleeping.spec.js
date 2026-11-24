"use strict";

jest.setTimeout(30 * 1000);

const Matter = require('../build/matter.dev');

const {
    Engine,
    Body,
    Composite,
    Constraint,
    Bodies
} = Matter;

const DELTA = 1000 / 60;
const SPACING = 80;

// MJ-B fixture: four equal mass bodies linked by three constraints in a
// chain, plus a fifth fully independent body. All bodies are put to sleep
// before one end of the chain is struck.
const createMJB = (options = {}) => {
    const engine = Engine.create({ enableSleeping: true });

    // remove gravity so the sleeping state is stable
    engine.gravity.y = 0;

    const chain = [];

    for (let i = 0; i < 4; i += 1) {
        chain.push(Bodies.rectangle(100 + i * SPACING, 300, 40, 40, {
            label: `chain-${i}`,
            sleepThreshold: 20
        }));
    }

    const lone = Bodies.rectangle(700, 300, 40, 40, {
        label: 'lone',
        sleepThreshold: 20
    });

    Composite.add(engine.world, chain.concat([lone]));

    const constraints = [];

    for (let i = 0; i < 3; i += 1) {
        const constraint = Constraint.create({
            bodyA: chain[i],
            bodyB: chain[i + 1],
            length: SPACING,
            stiffness: 1
        });

        constraints.push(constraint);
    }

    Composite.add(engine.world, constraints);

    if (options.breakMiddle) {
        Composite.remove(engine.world, constraints[1]);
    }

    // run until every body has gone to sleep
    for (let i = 0; i < 40; i += 1) {
        Engine.update(engine, DELTA);
    }

    return {
        engine,
        chain,
        lone,
        constraints: options.breakMiddle
            ? [constraints[0], constraints[2]]
            : constraints
    };
};

const sleepingStates = bodies => bodies.map(body => body.isSleeping);

const strike = (engine, body, speed) => {
    const projectile = Bodies.circle(
        body.position.x,
        body.position.y + 120,
        15,
        { label: 'projectile', sleepThreshold: 0 }
    );

    Composite.add(engine.world, projectile);
    Body.setVelocity(projectile, { x: 0, y: -speed });
};

// runs the engine and records the sleeping state after every update,
// returning the state of the first update where any watched body woke up
const firstWakeStates = (engine, bodies, steps) => {
    for (let i = 0; i < steps; i += 1) {
        Engine.update(engine, DELTA);

        const states = sleepingStates(bodies);

        if (states.some(isSleeping => !isSleeping)) {
            return states;
        }
    }

    throw new Error('no body woke up within the given number of updates');
};

describe('Sleeping constraint groups (MJ-B)', () => {
    test('all four connected bodies wake together on a single strike', () => {
        const { engine, chain, lone } = createMJB();

        expect(sleepingStates(chain)).toEqual([true, true, true, true]);
        expect(lone.isSleeping).toBe(true);

        strike(engine, chain[3], 8);

        // every chain body must be awake in the very same update that the
        // first one wakes, rather than one segment per update
        const firstWake = firstWakeStates(engine, chain, 14);
        expect(firstWake).toEqual([false, false, false, false]);
    });

    test('bodies without a constraint connection stay asleep', () => {
        const { engine, chain, lone } = createMJB();

        strike(engine, chain[3], 8);
        firstWakeStates(engine, chain, 14);

        expect(lone.isSleeping).toBe(true);
    });

    test('each constraint keeps its rest length within 0.2 after waking', () => {
        const { engine, chain, constraints } = createMJB();

        strike(engine, chain[3], 8);
        firstWakeStates(engine, chain, 14);

        for (const constraint of constraints) {
            expect(Math.abs(Constraint.currentLength(constraint) - constraint.length))
                .toBeLessThanOrEqual(0.2);
        }
    });

    test('repeating the strike produces an identical velocity sequence', () => {
        const velocitySequence = () => {
            const { engine, chain } = createMJB();

            strike(engine, chain[3], 8);

            const sequence = [];

            for (let i = 0; i < 12; i += 1) {
                Engine.update(engine, DELTA);
                sequence.push(chain.map(body => [
                    body.velocity.x,
                    body.velocity.y,
                    body.angularVelocity
                ]));
            }

            return sequence;
        };

        expect(velocitySequence()).toEqual(velocitySequence());
    });

    test('breaking the middle constraint only wakes the two separate groups', () => {
        const { engine, chain, lone } = createMJB({ breakMiddle: true });

        // strike the free end of the right hand group (chain[3])
        strike(engine, chain[3], 8);

        // at the first wake update only the right hand group is awake,
        // the left hand group and the lone body remain asleep
        const rightGroup = [chain[2], chain[3]];
        const firstWake = firstWakeStates(engine, rightGroup, 14);

        expect(firstWake).toEqual([false, false]);
        expect(sleepingStates([chain[0], chain[1]])).toEqual([true, true]);
        expect(lone.isSleeping).toBe(true);
    });

    test('a force applied to one body wakes its whole group in one update', () => {
        const { engine, chain, lone } = createMJB();

        Body.applyForce(chain[0], chain[0].position, { x: 0.02, y: 0 });
        Engine.update(engine, DELTA);

        expect(sleepingStates(chain)).toEqual([false, false, false, false]);
        expect(lone.isSleeping).toBe(true);
    });
});
