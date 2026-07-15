/**
 * Core API Client with SSE Streaming & Auto-Reconnect capability.
 */

export class SseStreamClient {
  constructor(options = {}) {
    this.baseUrl = options.url || '/api/odds/stream';
    this.initialBackoffMs = options.initialBackoffMs || 1000;
    this.maxBackoffMs = options.maxBackoffMs || 30000;
    this.backoffFactor = options.backoffFactor || 1.8;
    this.maxRetries = options.maxRetries ?? Infinity;
    this.queryParams = options.params || {};

    this.status = 'disconnected'; // 'disconnected' | 'connecting' | 'connected' | 'reconnecting'
    this.retryCount = 0;
    this.timerId = null;
    this.abortController = null;
    this.listeners = new Map();
  }

  on(event, callback) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event).add(callback);
    return () => this.off(event, callback);
  }

  off(event, callback) {
    if (this.listeners.has(event)) {
      this.listeners.get(event).delete(callback);
    }
  }

  emit(event, data) {
    if (this.listeners.has(event)) {
      for (const cb of this.listeners.get(event)) {
        try {
          cb(data);
        } catch (err) {
          console.error(`[SseStreamClient] Listener error for event '${event}':`, err);
        }
      }
    }
  }

  setParams(params = {}) {
    this.queryParams = { ...this.queryParams, ...params };
    if (this.status === 'connected' || this.status === 'connecting') {
      this.reconnect();
    }
  }

  setStatus(newStatus) {
    if (this.status !== newStatus) {
      const prevStatus = this.status;
      this.status = newStatus;
      this.emit('statusChange', { status: newStatus, prevStatus });
    }
  }

  connect() {
    if (this.status === 'connecting' || this.status === 'connected') return;

    this.clearTimer();
    this.setStatus('connecting');

    const urlParams = new URLSearchParams();
    for (const [k, v] of Object.entries(this.queryParams)) {
      if (v !== undefined && v !== null && v !== '') {
        urlParams.set(k, String(v));
      }
    }

    const fullUrl = `${this.baseUrl}${urlParams.toString() ? `?${urlParams.toString()}` : ''}`;
    this.abortController = new AbortController();

    fetch(fullUrl, { signal: this.abortController.signal })
      .then(async (res) => {
        if (!res.ok) {
          throw new Error(`HTTP ${res.status} ${res.statusText}`);
        }
        if (!res.body) {
          throw new Error('Readable stream not supported');
        }

        this.retryCount = 0;
        this.setStatus('connected');
        this.emit('connect', { url: fullUrl });

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;

            let dataStr = trimmed;
            if (trimmed.startsWith('data:')) {
              dataStr = trimmed.slice(5).trim();
            }

            try {
              const parsed = JSON.parse(dataStr);
              this.emit('message', parsed);
            } catch {
              this.emit('rawMessage', dataStr);
            }
          }
        }

        // Reader finished normally
        this.handleDisconnect('Server closed stream');
      })
      .catch((err) => {
        if (err.name === 'AbortError') {
          this.setStatus('disconnected');
          this.emit('disconnect', { reason: 'User aborted' });
          return;
        }
        this.emit('error', err);
        this.handleDisconnect(err.message || 'Stream connection failed');
      });
  }

  handleDisconnect(reason) {
    this.abortController = null;

    if (this.retryCount >= this.maxRetries) {
      this.setStatus('disconnected');
      this.emit('failed', { reason: 'Max retry limit reached', retries: this.retryCount });
      return;
    }

    this.setStatus('reconnecting');
    this.retryCount++;

    const backoff = Math.min(
      this.initialBackoffMs * Math.pow(this.backoffFactor, this.retryCount - 1),
      this.maxBackoffMs
    );
    const jitter = Math.random() * 0.3 * backoff;
    const delay = Math.round(backoff + jitter);

    this.emit('reconnectAttempt', { retryCount: this.retryCount, delay, reason });

    this.timerId = setTimeout(() => {
      this.connect();
    }, delay);
  }

  reconnect() {
    this.disconnect();
    this.connect();
  }

  disconnect() {
    this.clearTimer();
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    if (this.status !== 'disconnected') {
      this.setStatus('disconnected');
      this.emit('disconnect', { reason: 'Explicit disconnect' });
    }
  }

  clearTimer() {
    if (this.timerId) {
      clearTimeout(this.timerId);
      this.timerId = null;
    }
  }

  destroy() {
    this.disconnect();
    this.listeners.clear();
  }
}

export class ApiClient {
  constructor(options = {}) {
    this.baseUrl = options.baseUrl || '';
    this.defaultHeaders = options.headers || {
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    };
  }

  async request(endpoint, options = {}) {
    const url = `${this.baseUrl}${endpoint}`;
    const headers = { ...this.defaultHeaders, ...options.headers };
    const config = {
      ...options,
      headers
    };

    if (config.body && typeof config.body === 'object' && !(config.body instanceof FormData)) {
      config.body = JSON.stringify(config.body);
    }

    const response = await fetch(url, config);

    if (!response.ok) {
      let errorMessage = `HTTP ${response.status}: ${response.statusText}`;
      try {
        const errorData = await response.json();
        if (errorData && errorData.message) {
          errorMessage = errorData.message;
        }
      } catch {
        /* fallback to standard HTTP statusText */
      }
      const error = new Error(errorMessage);
      error.status = response.status;
      throw error;
    }

    if (response.status === 204) {
      return null;
    }

    return response.json();
  }

  get(endpoint, params = {}, options = {}) {
    const query = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null && v !== '') {
        query.set(k, String(v));
      }
    }
    const qs = query.toString();
    const fullEndpoint = qs ? `${endpoint}?${qs}` : endpoint;
    return this.request(fullEndpoint, { ...options, method: 'GET' });
  }

  post(endpoint, body = {}, options = {}) {
    return this.request(endpoint, { ...options, method: 'POST', body });
  }

  put(endpoint, body = {}, options = {}) {
    return this.request(endpoint, { ...options, method: 'PUT', body });
  }

  delete(endpoint, options = {}) {
    return this.request(endpoint, { ...options, method: 'DELETE' });
  }

  createStream(url, options = {}) {
    return new SseStreamClient({ url, ...options });
  }
}

export const apiClient = new ApiClient();
