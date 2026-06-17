class Mutex {
    constructor() {
        this._locked = false;
        this._waiters = [];
    }

    async acquire() {
        if (this._locked) {
            return new Promise(resolve => this._waiters.push(resolve));
        }
        this._locked = true;
    }

    release() {
        if (this._waiters.length > 0) {
            const next = this._waiters.shift();
            next();
        } else {
            this._locked = false;
        }
    }
}

module.exports = Mutex;
