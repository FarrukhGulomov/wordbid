'use client';

import { useEffect } from 'react';

const HEARTBEAT_INTERVAL_MS = 60_000;

/**
 * Renders nothing. Its only job is to ping /api/visit once on load and then every ~60s while
 * the tab stays open, which is the entire mechanism behind "online now" and "visitors" — a
 * crawler that never runs JavaScript never triggers this at all.
 */
export function VisitorHeartbeat() {
  useEffect(() => {
    const ping = () => {
      fetch('/api/visit', { method: 'POST', keepalive: true }).catch(() => {
        // A missed heartbeat just means this visitor looks briefly less "online" — never worth
        // surfacing to the user.
      });
    };

    ping();
    const timer = setInterval(ping, HEARTBEAT_INTERVAL_MS);
    return () => clearInterval(timer);
  }, []);

  return null;
}
