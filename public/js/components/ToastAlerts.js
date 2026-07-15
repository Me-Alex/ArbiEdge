/**
 * ToastAlerts UI Component
 * Displays floating toast notifications for high-edge surebets.
 */

'use strict';

class ToastManager {
  constructor({ containerId = 'toast-container' } = {}) {
    this.container = document.getElementById(containerId) || this.createContainer(containerId);
  }

  createContainer(id) {
    const el = document.createElement('div');
    el.id = id;
    el.className = 'toast-container';
    document.body.appendChild(el);
    return el;
  }

  show(message, { type = 'info', durationMs = 4000 } = {}) {
    const toast = document.createElement('div');
    toast.className = `toast-item toast-${type}`;
    toast.setAttribute('role', type === 'warning' ? 'alert' : 'status');
    toast.innerHTML = `
      <span class="toast-icon" aria-hidden="true"></span>
      <span class="toast-message">${escapeHtml(message)}</span>
      <button class="toast-close" type="button" aria-label="Dismiss notification">&times;</button>
    `;

    toast.querySelector('.toast-close').addEventListener('click', () => {
      toast.remove();
    });

    this.container.appendChild(toast);
    setTimeout(() => {
      if (toast.parentNode) {
        toast.remove();
      }
    }, durationMs);
  }
}

function escapeHtml(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const toastManager = new ToastManager();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { ToastManager, toastManager };
}
