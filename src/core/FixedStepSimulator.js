/**
* The `Matter.FixedStepSimulator` module is a deterministic fixed-timestep simulator driver with pause support.
*
* Unlike `Matter.Runner` (which favours a smooth user experience in the browser), this simulator favours
* exact reproducibility: given the same sequence of frame times, it always performs the same fixed-size
* `Engine.update` steps and therefore produces identical physics snapshots. This makes it suitable for
* replays, lockstep networking, recorded sessions and environments outside the browser.
*
* Time is accumulated in an accumulator. While paused the accumulator and simulated time are frozen.
* Rendering should use the read-only interpolation helpers (`getInterpolationAlpha` and
* `interpolatePosition`), which never modify any physics state.
*
* @class FixedStepSimulator
*/

var FixedStepSimulator = {};

module.exports = FixedStepSimulator;

var Events = require('./Events');
var Engine = require('./Engine');
var Common = require('./Common');

(function() {

    FixedStepSimulator._defaultDelta = 1000 / 60;
    FixedStepSimulator._defaultMaxFrameDelta = 100;
    FixedStepSimulator._defaultMaxStepsPerFrame = 6;

    /**
     * Creates a new fixed-step simulator.
     * See the properties section below for detailed information on what you can pass via the `options` object.
     * @method create
     * @param {} options
     * @return {simulator} simulator
     */
    FixedStepSimulator.create = function(options) {
        var defaults = {
            delta: FixedStepSimulator._defaultDelta,
            maxFrameDelta: FixedStepSimulator._defaultMaxFrameDelta,
            maxStepsPerFrame: FixedStepSimulator._defaultMaxStepsPerFrame,
            accumulator: 0,
            time: 0,
            stepCount: 0,
            lastStepCount: 0,
            frameDelta: 0,
            alpha: 0,
            paused: false,
            enabled: true,
            timeLastTick: 0
        };

        return Common.extend(defaults, options);
    };

    /**
     * Advances the simulator to the given frame time, performing as many fixed-size
     * `Engine.update` steps as the accumulated time allows.
     *
     * A single frame delta larger than `simulator.maxFrameDelta` (default `100` ms) is clamped so that
     * at most `simulator.maxStepsPerFrame` (default `6`) catch-up steps are performed for that frame,
     * discarding any further excess time. This keeps playback speed stable at low frame rates.
     *
     * While paused (or disabled) the accumulator and simulated time are left unchanged and no steps
     * are performed, so resuming later does not accumulate the time spent paused.
     *
     * @method tick
     * @param {simulator} simulator
     * @param {engine} [engine] An optional engine to update on each fixed step.
     * @param {number} time The current frame time in milliseconds.
     * @return {number} The number of fixed steps performed by this tick.
     */
    FixedStepSimulator.tick = function(simulator, engine, time) {
        var frameDelta = time - simulator.timeLastTick;

        // always track the last tick time, even while paused,
        // so that time spent paused is never accumulated on resume
        simulator.timeLastTick = time;
        simulator.lastStepCount = 0;

        if (simulator.paused || !simulator.enabled) {
            return 0;
        }

        // ignore unusable frame delta values (e.g. negative or NaN)
        if (!(frameDelta > 0)) {
            frameDelta = 0;
        }

        // clamp a single long frame to a bounded number of catch-up steps
        if (frameDelta > simulator.maxFrameDelta) {
            frameDelta = simulator.maxStepsPerFrame * simulator.delta;
        }

        simulator.frameDelta = frameDelta;
        simulator.accumulator += frameDelta;

        var event = {
            timestamp: engine ? engine.timing.timestamp : simulator.time
        };

        Events.trigger(simulator, 'beforeTick', event);

        var delta = simulator.delta;

        // consume the accumulated time in fixed-size steps
        while (simulator.accumulator >= delta && simulator.lastStepCount < simulator.maxStepsPerFrame) {
            Events.trigger(simulator, 'beforeStep', event);

            if (engine) {
                Engine.update(engine, delta);
            }

            simulator.accumulator -= delta;
            simulator.time += delta;
            simulator.stepCount += 1;
            simulator.lastStepCount += 1;

            Events.trigger(simulator, 'afterStep', event);
        }

        // interpolation factor for rendering, a pure function of the accumulator
        simulator.alpha = simulator.accumulator / delta;

        Events.trigger(simulator, 'afterTick', event);

        return simulator.lastStepCount;
    };

    /**
     * Pauses the simulator. While paused, calls to `FixedStepSimulator.tick` perform no steps and
     * leave the accumulator and simulated time unchanged.
     * @method pause
     * @param {simulator} simulator
     */
    FixedStepSimulator.pause = function(simulator) {
        simulator.paused = true;
    };

    /**
     * Resumes a paused simulator. The time elapsed while paused is not accumulated,
     * so playback continues from exactly the physics state it was paused in.
     * @method resume
     * @param {simulator} simulator
     */
    FixedStepSimulator.resume = function(simulator) {
        simulator.paused = false;
    };

    /**
     * Returns the current interpolation factor in the range `[0, 1)`, describing how far the
     * accumulated (not yet simulated) time has progressed towards the next fixed step.
     * Intended for render interpolation only; reading it has no effect on physics state.
     * @method getInterpolationAlpha
     * @param {simulator} simulator
     * @return {number} The interpolation factor alpha.
     */
    FixedStepSimulator.getInterpolationAlpha = function(simulator) {
        return simulator.alpha;
    };

    /**
     * Returns the render-interpolated position of the given body for the interpolation factor `alpha`,
     * as a new vector between `body.positionPrev` (alpha `0`) and `body.position` (alpha `1`).
     *
     * This function is pure and read-only: it never writes to the body or any other physics state,
     * so the interpolated result only affects draw coordinates and two identical replays always
     * produce identical physics snapshots regardless of how interpolation is sampled.
     *
     * @method interpolatePosition
     * @param {body} body
     * @param {number} alpha The interpolation factor, see `FixedStepSimulator.getInterpolationAlpha`.
     * @return {vector} A new vector with the interpolated draw position.
     */
    FixedStepSimulator.interpolatePosition = function(body, alpha) {
        return {
            x: body.positionPrev.x + (body.position.x - body.positionPrev.x) * alpha,
            y: body.positionPrev.y + (body.position.y - body.positionPrev.y) * alpha
        };
    };

    /*
    *
    *  Events Documentation
    *
    */

    /**
    * Fired once at the start of each tick, before any fixed steps.
    *
    * @event beforeTick
    * @param {} event An event object
    * @param {number} event.timestamp The timestamp of the event
    * @param {} event.source The source object of the event
    * @param {} event.name The name of the event
    */

    /**
    * Fired once at the end of each tick, after any fixed steps.
    *
    * @event afterTick
    * @param {} event An event object
    * @param {number} event.timestamp The timestamp of the event
    * @param {} event.source The source object of the event
    * @param {} event.name The name of the event
    */

    /**
    * Fired before each fixed step performed in a tick.
    *
    * @event beforeStep
    * @param {} event An event object
    * @param {number} event.timestamp The timestamp of the event
    * @param {} event.source The source object of the event
    * @param {} event.name The name of the event
    */

    /**
    * Fired after each fixed step performed in a tick.
    *
    * @event afterStep
    * @param {} event An event object
    * @param {number} event.timestamp The timestamp of the event
    * @param {} event.source The source object of the event
    * @param {} event.name The name of the event
    */

    /*
    *
    *  Properties Documentation
    *
    */

    /**
     * The fixed timestep size used for each `Engine.update` step in milliseconds.
     *
     * @property delta
     * @type number
     * @default 1000 / 60
     */

    /**
     * The maximum frame delta accepted in a single tick in milliseconds.
     * A larger frame delta is clamped so that at most `maxStepsPerFrame` catch-up steps are performed.
     *
     * @property maxFrameDelta
     * @type number
     * @default 100
     */

    /**
     * The maximum number of fixed steps performed in a single tick.
     *
     * @property maxStepsPerFrame
     * @type number
     * @default 6
     */

    /**
     * The accumulated time elapsed that has yet to be simulated in milliseconds.
     * This value does not change while the simulator is paused.
     *
     * @readonly
     * @property accumulator
     * @type number
     * @default 0
     */

    /**
     * The total simulated time in milliseconds, i.e. `stepCount * delta`.
     * This value does not change while the simulator is paused.
     *
     * @readonly
     * @property time
     * @type number
     * @default 0
     */

    /**
     * The total number of fixed steps performed since creation.
     *
     * @readonly
     * @property stepCount
     * @type number
     * @default 0
     */

    /**
     * The number of fixed steps performed by the most recent tick.
     *
     * @readonly
     * @property lastStepCount
     * @type number
     * @default 0
     */

    /**
     * The frame delta accepted by the most recent tick, after clamping, in milliseconds.
     *
     * @readonly
     * @property frameDelta
     * @type number
     * @default 0
     */

    /**
     * The current interpolation factor for rendering, see `FixedStepSimulator.getInterpolationAlpha`.
     *
     * @readonly
     * @property alpha
     * @type number
     * @default 0
     */

    /**
     * Whether the simulator is currently paused, see `FixedStepSimulator.pause` and `FixedStepSimulator.resume`.
     *
     * @property paused
     * @type boolean
     * @default false
     */

    /**
     * A flag that can be toggled to enable or disable stepping on this simulator.
     *
     * @property enabled
     * @type boolean
     * @default true
     */

    /**
     * The timestamp of the last call to `FixedStepSimulator.tick` used to measure `frameDelta`.
     *
     * @private
     * @property timeLastTick
     * @type number
     * @default 0
     */

})();
