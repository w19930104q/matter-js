/**
* The `Matter.Sleeping` module contains methods to manage the sleeping state of bodies.
*
* @class Sleeping
*/

var Sleeping = {};

module.exports = Sleeping;

var Body = require('../body/Body');
var Events = require('./Events');
var Common = require('./Common');

(function() {

    Sleeping._motionWakeThreshold = 0.18;
    Sleeping._motionSleepThreshold = 0.08;
    Sleeping._minBias = 0.9;

    /**
     * Puts bodies to sleep or wakes them up depending on their motion.
     * @method update
     * @param {body[]} bodies
     * @param {number} delta
     */
    Sleeping.update = function(bodies, delta) {
        var timeScale = delta / Common._baseDelta,
            motionSleepThreshold = Sleeping._motionSleepThreshold;
        
        // update bodies sleeping status
        for (var i = 0; i < bodies.length; i++) {
            var body = bodies[i],
                speed = Body.getSpeed(body),
                angularSpeed = Body.getAngularSpeed(body),
                motion = speed * speed + angularSpeed * angularSpeed;

            // wake up bodies if they have a force applied
            if (body.force.x !== 0 || body.force.y !== 0) {
                Sleeping.set(body, false);
                continue;
            }

            var minMotion = Math.min(body.motion, motion),
                maxMotion = Math.max(body.motion, motion);
        
            // biased average motion estimation between frames
            body.motion = Sleeping._minBias * minMotion + (1 - Sleeping._minBias) * maxMotion;

            if (body.sleepThreshold > 0 && body.motion < motionSleepThreshold) {
                body.sleepCounter += 1;
                
                if (body.sleepCounter >= body.sleepThreshold / timeScale) {
                    Sleeping.set(body, true);
                }
            } else if (body.sleepCounter > 0) {
                body.sleepCounter -= 1;
            }
        }
    };

    /**
     * Given a set of colliding pairs, wakes the sleeping bodies involved.
     * @method afterCollisions
     * @param {pair[]} pairs
     */
    Sleeping.afterCollisions = function(pairs) {
        var motionSleepThreshold = Sleeping._motionSleepThreshold;

        // wake up bodies involved in collisions
        for (var i = 0; i < pairs.length; i++) {
            var pair = pairs[i];
            
            // don't wake inactive pairs
            if (!pair.isActive)
                continue;

            var collision = pair.collision,
                bodyA = collision.bodyA.parent, 
                bodyB = collision.bodyB.parent;
        
            // don't wake if at least one body is static
            if ((bodyA.isSleeping && bodyB.isSleeping) || bodyA.isStatic || bodyB.isStatic)
                continue;
        
            if (bodyA.isSleeping || bodyB.isSleeping) {
                var sleepingBody = (bodyA.isSleeping && !bodyA.isStatic) ? bodyA : bodyB,
                    movingBody = sleepingBody === bodyA ? bodyB : bodyA;

                if (!sleepingBody.isStatic && movingBody.motion > motionSleepThreshold) {
                    Sleeping.set(sleepingBody, false);
                }
            }
        }
    };
  
    /**
     * Wakes every sleeping body in the constraint connected groups of any
     * awake body. Bodies joined by constraints form a graph, so when one body
     * in a group is woken (e.g. by a collision, an applied force or a drag)
     * the whole group is woken in the same update, while sleeping bodies in
     * other disconnected groups are left untouched.
     * @method wakeConstraints
     * @param {constraint[]} constraints
     */
    Sleeping.wakeConstraints = function(constraints) {
        // build the constraint graph of dynamic bodies as an adjacency list
        var neighbours = {};

        for (var i = 0; i < constraints.length; i++) {
            var constraint = constraints[i],
                bodyA = constraint.bodyA,
                bodyB = constraint.bodyB;

            // constraints anchored to the world or a static body cannot
            // propagate a wake between dynamic bodies
            if (!bodyA || !bodyB || bodyA.isStatic || bodyB.isStatic)
                continue;

            if (!neighbours[bodyA.id]) {
                neighbours[bodyA.id] = [];
            }

            neighbours[bodyA.id].push(bodyB);

            if (!neighbours[bodyB.id]) {
                neighbours[bodyB.id] = [];
            }

            neighbours[bodyB.id].push(bodyA);
        }

        // flood fill from each awake body across its constraint group
        var visited = {};

        for (i = 0; i < constraints.length; i++) {
            constraint = constraints[i];
            bodyA = constraint.bodyA;
            bodyB = constraint.bodyB;

            if (bodyA && !bodyA.isStatic && !bodyA.isSleeping && !visited[bodyA.id]) {
                Sleeping._wakeGroup(bodyA, neighbours, visited);
            }

            if (bodyB && !bodyB.isStatic && !bodyB.isSleeping && !visited[bodyB.id]) {
                Sleeping._wakeGroup(bodyB, neighbours, visited);
            }
        }
    };

    /**
     * Wakes the constraint connected group of the given body using a
     * breadth first search, recording traversed bodies in `visited` so each
     * group is only traversed once per call.
     * @method _wakeGroup
     * @private
     * @param {body} startBody
     * @param {object} neighbours
     * @param {object} visited
     */
    Sleeping._wakeGroup = function(startBody, neighbours, visited) {
        var queue = [startBody];
        visited[startBody.id] = true;

        while (queue.length > 0) {
            var body = queue.shift(),
                bodyNeighbours = neighbours[body.id];

            if (!bodyNeighbours)
                continue;

            for (var i = 0; i < bodyNeighbours.length; i++) {
                var neighbour = bodyNeighbours[i];

                if (visited[neighbour.id])
                    continue;

                visited[neighbour.id] = true;

                if (neighbour.isSleeping) {
                    Sleeping.set(neighbour, false);
                }

                queue.push(neighbour);
            }
        }
    };

    /**
     * Set a body as sleeping or awake.
     * @method set
     * @param {body} body
     * @param {boolean} isSleeping
     */
    Sleeping.set = function(body, isSleeping) {
        var wasSleeping = body.isSleeping;

        if (isSleeping) {
            body.isSleeping = true;
            body.sleepCounter = body.sleepThreshold;

            body.positionImpulse.x = 0;
            body.positionImpulse.y = 0;

            body.positionPrev.x = body.position.x;
            body.positionPrev.y = body.position.y;

            body.anglePrev = body.angle;
            body.speed = 0;
            body.angularSpeed = 0;
            body.motion = 0;

            if (!wasSleeping) {
                Events.trigger(body, 'sleepStart');
            }
        } else {
            body.isSleeping = false;
            body.sleepCounter = 0;

            if (wasSleeping) {
                Events.trigger(body, 'sleepEnd');
            }
        }
    };

})();
