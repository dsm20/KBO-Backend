const DEFAULT_CONCURRENCY = 4;

class TaskQueue {
  #queue = [];
  #running = 0;
  #concurrency;
  #paused = false;
  #drainResolvers = [];

  constructor({ concurrency = DEFAULT_CONCURRENCY } = {}) {
    this.#concurrency = concurrency;
  }

  add(fn, { priority = 0 } = {}) {
    return new Promise((resolve, reject) => {
      const task = { fn, priority, resolve, reject };

      const idx = this.#queue.findIndex((t) => t.priority < priority);
      if (idx === -1) {
        this.#queue.push(task);
      } else {
        this.#queue.splice(idx, 0, task);
      }

      this.#process();
    });
  }

  async #process() {
    if (this.#paused) return;

    while (this.#running < this.#concurrency && this.#queue.length > 0) {
      const task = this.#queue.shift();
      this.#running++;

      task
        .fn()
        .then(task.resolve)
        .catch(task.reject)
        .finally(() => {
          this.#running--;
          this.#process();

          if (this.#running === 0 && this.#queue.length === 0) {
            for (const resolve of this.#drainResolvers) resolve();
            this.#drainResolvers = [];
          }
        });
    }
  }

  pause() {
    this.#paused = true;
  }

  resume() {
    this.#paused = false;
    this.#process();
  }

  drain() {
    if (this.#running === 0 && this.#queue.length === 0) {
      return Promise.resolve();
    }
    return new Promise((resolve) => this.#drainResolvers.push(resolve));
  }

  clear() {
    const dropped = this.#queue.length;
    for (const task of this.#queue) {
      task.reject(new Error("Task cancelled — queue cleared"));
    }
    this.#queue = [];
    return dropped;
  }

  get pending() {
    return this.#queue.length;
  }

  get active() {
    return this.#running;
  }

  get size() {
    return this.#queue.length + this.#running;
  }
}

export { TaskQueue };
