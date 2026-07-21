let heartbeatInterval: ReturnType<typeof setInterval>;
let missedBeats = 0;
const MAX_MISSED_BEATS = 3;

export function startHeartbeat(channel: RTCDataChannel, handleDisconnection: () => void) {
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
  }
  missedBeats = 0;
  heartbeatInterval = setInterval(() => {
    if (channel.readyState === 'open') {
      try {
        console.log("💓 [Heartbeat] Sending PING to peer...");
        channel.send(JSON.stringify({ type: 'HEARTBEAT_PING' }));
        missedBeats++;

        if (missedBeats >= MAX_MISSED_BEATS) {
          console.warn(`💓 [Heartbeat] Missed ${missedBeats} beats. Disconnecting...`);
          clearInterval(heartbeatInterval);
          handleDisconnection();
        }
      } catch (err) {
        console.error("Failed to send heartbeat", err);
      }
    } else {
      clearInterval(heartbeatInterval);
    }
  }, 5000);
}

export function handleHeartbeatMessage(channel: RTCDataChannel, parsedMessage: any) {
  if (parsedMessage.type === 'HEARTBEAT_PING') {
    if (channel.readyState === 'open') {
      try {
        console.log("💓 [Heartbeat] Received PING from peer. Sending PONG...");
        channel.send(JSON.stringify({ type: 'HEARTBEAT_PONG' }));
      } catch (err) {
        console.error("Failed to send pong", err);
      }
    }
  } else if (parsedMessage.type === 'HEARTBEAT_PONG') {
    console.log("💓 [Heartbeat] Received PONG from peer. Connection active.");
    missedBeats = 0;
  }
}

export function stopHeartbeat() {
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
  }
}

export async function wipeLocalCache() {
  try {
    if (typeof navigator !== 'undefined' && navigator.storage && typeof navigator.storage.getDirectory === 'function') {
      const root = await navigator.storage.getDirectory();
      
      // @ts-ignore
      for await (const [name] of root.entries()) {
        await root.removeEntry(name, { recursive: true });
      }
    }

    if (typeof indexedDB !== 'undefined') {
      const request = indexedDB.deleteDatabase("ContinuityDB");
      request.onsuccess = () => {
        window.postMessage({ type: 'UI_STATE_RESET' }, '*');
      };
    } else {
      window.postMessage({ type: 'UI_STATE_RESET' }, '*');
    }
  } catch (error) {
    console.error("Failed to wipe local cache", error);
    window.postMessage({ type: 'UI_STATE_RESET' }, '*');
  }
}
