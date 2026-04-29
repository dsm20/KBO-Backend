const DEFAULT_MAX_LISTENERS = 10;

class TypedEventEmitter {
  #handlers = new Map();
  #maxListeners;
  #onceWrapped = new WeakSet();

  constructor({ maxListeners = DEFAULT_MAX_LISTENERS } = {}) {
    this.#maxListeners = maxListeners;
  }

  on(event, handler) {
    if (!this.#handlers.has(event)) {
      this.#handlers.set(event, []);
    }

    const list = this.#handlers.get(event);
    if (list.length >= this.#maxListeners) {
      console.warn(
        `MaxListenersExceeded: ${event} has ${list.length} listeners (limit: ${this.#maxListeners})`
      );
    }

    list.push(handler);
    return () => this.off(event, handler);
  }

  once(event, handler) {
    const wrapper = (...args) => {
      this.off(event, wrapper);
      return handler(...args);
    };
    this.#onceWrapped.add(wrapper);
    return this.on(event, wrapper);
  }

  off(event, handler) {
    const list = this.#handlers.get(event);
    if (!list) return false;

    const idx = list.indexOf(handler);
    if (idx === -1) return false;

    list.splice(idx, 1);
    if (list.length === 0) this.#handlers.delete(event);
    return true;
  }

  emit(event, ...args) {
    const list = this.#handlers.get(event);
    if (!list || list.length === 0) return false;

    for (const handler of [...list]) {
      try {
        handler(...args);
      } catch (err) {
        if (event !== "error") {
          this.emit("error", err);
        } else {
          throw err;
        }
      }
    }
    return true;
  }

  listenerCount(event) {
    return this.#handlers.get(event)?.length ?? 0;
  }

  removeAllListeners(event) {
    if (event) {
      this.#handlers.delete(event);
    } else {
      this.#handlers.clear();
    }
  }
}

export { TypedEventEmitter };
