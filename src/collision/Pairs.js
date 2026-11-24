/**
* The `Matter.Pairs` module contains methods for creating and manipulating collision pair sets.
*
* @class Pairs
*/

var Pairs = {};

module.exports = Pairs;

var Pair = require('./Pair');
var Common = require('../core/Common');

(function() {

    /**
     * Creates a new pairs structure.
     * @method create
     * @param {object} options
     * @return {pairs} A new pairs structure
     */
    Pairs.create = function(options) {
        return Common.extend({ 
            table: {},
            list: [],
            collisionStart: [],
            collisionActive: [],
            collisionEnd: []
        }, options);
    };

    /**
     * Updates pairs given a list of collisions.
     * @method update
     * @param {object} pairs
     * @param {collision[]} collisions
     * @param {number} timestamp
     */
    Pairs.update = function(pairs, collisions, timestamp) {
        var pairUpdate = Pair.update,
            pairCreate = Pair.create,
            pairSetActive = Pair.setActive,
            pairsTable = pairs.table,
            pairsList = pairs.list,
            pairsListLength = pairsList.length,
            pairsListIndex = pairsListLength,
            collisionStart = pairs.collisionStart,
            collisionEnd = pairs.collisionEnd,
            collisionActive = pairs.collisionActive,
            collisionsLength = collisions.length,
            collisionStartIndex = 0,
            collisionEndIndex = 0,
            collisionActiveIndex = 0,
            collision,
            pair,
            i;

        for (i = 0; i < collisionsLength; i++) {
            collision = collisions[i];
            pair = collision.pair;

            if (pair) {
                // pair already exists (but may or may not be active)
                if (pair.isActive) {
                    // pair exists and is active
                    collisionActive[collisionActiveIndex++] = pair;
                }

                // update the pair
                pairUpdate(pair, collision, timestamp);
            } else {
                // pair did not exist, create a new pair
                pair = pairCreate(collision, timestamp);
                pairsTable[pair.id] = pair;

                // add the new pair
                collisionStart[collisionStartIndex++] = pair;
                pairsList[pairsListIndex++] = pair;
            }
        }

        // find pairs that are no longer active
        pairsListIndex = 0;
        pairsListLength = pairsList.length;

        for (i = 0; i < pairsListLength; i++) {
            pair = pairsList[i];
            
            // pair is active if updated this timestep
            if (pair.timeUpdated >= timestamp) {
                // keep active pairs
                pairsList[pairsListIndex++] = pair;
            } else {
                pairSetActive(pair, false, timestamp);

                // keep inactive pairs if both bodies may be sleeping
                if (pair.collision.bodyA.sleepCounter > 0 && pair.collision.bodyB.sleepCounter > 0) {
                    pairsList[pairsListIndex++] = pair;
                } else {
                    // remove inactive pairs if either body awake
                    collisionEnd[collisionEndIndex++] = pair;
                    delete pairsTable[pair.id];
                }
            }
        }

        // update array lengths if changed
        if (pairsList.length !== pairsListIndex) {
            pairsList.length = pairsListIndex;
        }

        if (collisionStart.length !== collisionStartIndex) {
            collisionStart.length = collisionStartIndex;
        }

        if (collisionEnd.length !== collisionEndIndex) {
            collisionEnd.length = collisionEndIndex;
        }

        if (collisionActive.length !== collisionActiveIndex) {
            collisionActive.length = collisionActiveIndex;
        }
    };

    /**
     * Removes all pairs that involve the given body from the pairs structure,
     * including any entries staged in the current timestep collision event lists.
     * Used to keep the pair cache consistent when a body is removed from the
     * world mid-update (e.g. inside a `collisionStart` event handler).
     *
     * Compound bodies are handled by matching against any of their parts,
     * since pairs store the colliding parts rather than the parent body.
     * @method removeBody
     * @param {pairs} pairs
     * @param {body} body
     */
    Pairs.removeBody = function(pairs, body) {
        var pairsTable = pairs.table,
            pairsList = pairs.list,
            collisionStart = pairs.collisionStart,
            collisionActive = pairs.collisionActive,
            collisionEnd = pairs.collisionEnd,
            removedParts = body.parts || [body],
            pair,
            i,
            j;

        var involvesBody = function(pair) {
            if (pair.bodyA === body || pair.bodyB === body) {
                return true;
            }

            // compound bodies: the pair stores the colliding part
            for (j = 0; j < removedParts.length; j++) {
                var part = removedParts[j];

                if (pair.bodyA === part || pair.bodyB === part) {
                    return true;
                }
            }

            return false;
        };

        // remove from the active list and the lookup table
        for (i = pairsList.length - 1; i >= 0; i--) {
            pair = pairsList[i];

            if (involvesBody(pair)) {
                pair.isActive = false;
                delete pairsTable[pair.id];
                pairsList.splice(i, 1);
            }
        }

        // remove from every event list staged for the current timestep
        var removeFromEventList = function(list) {
            var writeIndex = 0;

            for (i = 0; i < list.length; i++) {
                if (!involvesBody(list[i])) {
                    list[writeIndex++] = list[i];
                }
            }

            list.length = writeIndex;
        };

        removeFromEventList(collisionStart);
        removeFromEventList(collisionActive);
        removeFromEventList(collisionEnd);
    };

    /**
     * Clears the given pairs structure.
     * @method clear
     * @param {pairs} pairs
     * @return {pairs} pairs
     */
    Pairs.clear = function(pairs) {
        pairs.table = {};
        pairs.list.length = 0;
        pairs.collisionStart.length = 0;
        pairs.collisionActive.length = 0;
        pairs.collisionEnd.length = 0;
        return pairs;
    };

})();
