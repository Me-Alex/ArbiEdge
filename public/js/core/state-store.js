/**
 * Pub/Sub State Store & Event Emitter for reactive frontend state management.
 */

export class EventEmitter {
  constructor() {
    this._events = new Map();
  }

  on(event, listener) {
    if (typeof listener !== 'function') {
      throw new TypeError('Listener must be a function');
    }
    if (!this._events.has(event)) {
      this._events.set(event, new Set());
    }
    this._events.get(event).add(listener);
    return () => this.off(event, listener);
  }

  once(event, listener) {
    if (typeof listener !== 'function') {
      throw new TypeError('Listener must be a function');
    }
    const wrapper = (data) => {
      this.off(event, wrapper);
      listener(data);
    };
    return this.on(event, wrapper);
  }

  off(event, listener) {
    if (!this._events.has(event)) return;
    if (!listener) {
      this._events.delete(event);
    } else {
      this._events.get(event).delete(listener);
    }
  }

  emit(event, data) {
    if (!this._events.has(event)) return;
    for (const listener of this._events.get(event)) {
      try {
        listener(data);
      } catch (err) {
        console.error(`[EventEmitter] Error handling event "${event}":`, err);
      }
    }
  }

  removeAllListeners(event) {
    if (event) {
      this._events.delete(event);
    } else {
      this._events.clear();
    }
  }
}

export class StateStore extends EventEmitter {
  constructor(initialState = {}) {
    super();
    this._initialState = { ...initialState };
    this._state = { ...initialState };
    this._keySubscribers = new Map();
    this._allSubscribers = new Set();
  }

  /**
   * Returns a copy or slice of the current state.
   */
  getState() {
    return { ...this._state };
  }

  /**
   * Retrieves a single key from state.
   */
  get(key) {
    return this._state[key];
  }

  /**
   * Sets state properties and notifies subscribers.
   * Accepts a partial state object or a functional updater: (prevState) => partialState
   */
  setState(updater) {
    const changes = typeof updater === 'function' ? updater(this._state) : updater;
    if (!changes || typeof changes !== 'object') return;

    const prevState = { ...this._state };
    const changedKeys = [];

    for (const key of Object.keys(changes)) {
      const prevVal = prevState[key];
      const newVal = changes[key];

      if (prevVal !== newVal) {
        this._state[key] = newVal;
        changedKeys.push(key);
      }
    }

    if (changedKeys.length === 0) return;

    const newState = this.getState();

    // 1. Fire key-specific subscribers and events
    for (const key of changedKeys) {
      const newVal = this._state[key];
      const prevVal = prevState[key];

      this.emit(`change:${key}`, { value: newVal, oldValue: prevVal, key });

      if (this._keySubscribers.has(key)) {
        for (const cb of this._keySubscribers.get(key)) {
          try {
            cb(newVal, prevVal, key);
          } catch (err) {
            console.error(`[StateStore] Error in subscriber for key "${key}":`, err);
          }
        }
      }
    }

    // 2. Fire global state subscribers
    for (const cb of this._allSubscribers) {
      try {
        cb(newState, prevState, changedKeys);
      } catch (err) {
        console.error('[StateStore] Error in global subscriber:', err);
      }
    }

    // 3. Fire global change event
    this.emit('change', { state: newState, prevState, changedKeys });
  }

  /**
   * Reset state back to initial state or a custom state replacement.
   */
  reset(replacementState = null) {
    const nextState = replacementState ? { ...replacementState } : { ...this._initialState };
    this.setState(() => nextState);
  }

  /**
   * Subscribe to changes for a specific state key.
   */
  subscribe(key, listener) {
    if (typeof listener !== 'function') {
      throw new TypeError('Listener must be a function');
    }
    if (!this._keySubscribers.has(key)) {
      this._keySubscribers.set(key, new Set());
    }
    this._keySubscribers.get(key).add(listener);
    return () => {
      const set = this._keySubscribers.get(key);
      if (set) {
        set.delete(listener);
      }
    };
  }

  /**
   * Subscribe to all state updates.
   */
  subscribeAll(listener) {
    if (typeof listener !== 'function') {
      throw new TypeError('Listener must be a function');
    }
    this._allSubscribers.add(listener);
    return () => {
      this._allSubscribers.delete(listener);
    };
  }
}

export const stateStore = new StateStore();
