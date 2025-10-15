// This is the Edge Chat Demo Worker, built using Durable Objects!
import HTML from "../../chatapp/dist/index.html";

async function handleErrors(request, func) {
  try {
    return await func();
  } catch (err) {
    if (request.headers.get("Upgrade") == "websocket") {
      let pair = new WebSocketPair();
      pair[1].accept();
      pair[1].send(JSON.stringify({ error: err.stack }));
      pair[1].close(1011, "Uncaught exception during session setup");
      return new Response(null, { status: 101, webSocket: pair[0] });
    } else {
      return new Response(err.stack, { status: 500 });
    }
  }
}

export default {
  async fetch(request, env) {
    return await handleErrors(request, async () => {
      let url = new URL(request.url);
      let path = url.pathname.slice(1).split("/");

        // ✅ Handle API first
        if (path[0] === "api") {
        return handleApiRequest(path.slice(1), request, env);
        }

        // ✅ Serve SPA HTML for any other route
        return new Response(HTML, {
        headers: { "Content-Type": "text/html;charset=UTF-8" },
        });
    });
  },
};

async function handleApiRequest(path, request, env) {
  // Handle CORS preflight requests
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, Accept',
        'Access-Control-Max-Age': '86400',
      },
    });
  }

  switch (path[0]) {
    case "room": {
      if (!path[1]) {
        if (request.method == "POST") {
          let id = env.rooms.newUniqueId();
          return new Response(id.toString(), {
            headers: { 
              "Access-Control-Allow-Origin": "*",
              "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
              "Access-Control-Allow-Headers": "Content-Type, Authorization, Accept",
            },
          });
        } else {
          return new Response("Method not allowed", { status: 405 });
        }
      }

      let name = path[1];
      let id;
      if (name.match(/^[0-9a-f]{64}$/)) {
        id = env.rooms.idFromString(name);
      } else if (name.length <= 32) {
        id = env.rooms.idFromName(name);
      } else {
        return new Response("Name too long", { status: 404 });
      }

      let roomObject = env.rooms.get(id);
      let newUrl = new URL(request.url);
      newUrl.pathname = "/" + path.slice(2).join("/");
      return roomObject.fetch(newUrl, request);
    }

    default:
      return new Response("Not found", { status: 404 });
  }
}

export class ChatRoom {
  constructor(state, env) {
    this.state = state;
    this.storage = state.storage;
    this.env = env;
    this.sessions = new Map();
    
    // Restore WebSocket sessions from hibernation
    this.state.getWebSockets().forEach((webSocket) => {
      let meta = webSocket.deserializeAttachment();
      if (meta && meta.limiterId) {
        let limiterId = this.env.limiters.idFromString(meta.limiterId);
        let limiter = new RateLimiterClient(
          () => this.env.limiters.get(limiterId),
          (err) => {
            console.error("Rate limiter error:", err);
            // Don't close WebSocket immediately, just log the error
          }
        );
        this.sessions.set(webSocket, { 
          ...meta, 
          limiter, 
          blockedMessages: [],
          lastSeen: Date.now()
        });
      }
    });
    this.lastTimestamp = 0;
    
    // Set up periodic cleanup
    this.setupCleanup();
  }

  setupCleanup() {
    // Clean up stale sessions every 30 seconds
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    this.cleanupInterval = setInterval(() => {
      this.cleanupStaleSessions();
    }, 30000);
  }

  cleanupStaleSessions() {
    const now = Date.now();
    const staleThreshold = 5 * 60 * 1000; // 5 minutes
    
    for (let [webSocket, session] of this.sessions.entries()) {
      if (session.lastSeen && (now - session.lastSeen) > staleThreshold) {
        console.log("Cleaning up stale session for:", session.name);
        this.sessions.delete(webSocket);
        if (session.name) {
          this.broadcast({ quit: session.name });
        }
      }
    }
  }

  async fetch(request) {
    return await handleErrors(request, async () => {
      let url = new URL(request.url);
      switch (url.pathname) {
        case "/websocket": {
          if (request.headers.get("Upgrade") != "websocket") {
            return new Response("expected websocket", { status: 400 });
          }
          let ip = request.headers.get("CF-Connecting-IP");
          let pair = new WebSocketPair();
          await this.handleSession(pair[1], ip);
          return new Response(null, { status: 101, webSocket: pair[0] });
        }
        default:
          return new Response("Not found", { status: 404 });
      }
    });
  }

  async handleSession(webSocket, ip) {
    try {
      // Accept the WebSocket connection
      this.state.acceptWebSocket(webSocket);
      
      let limiterId = this.env.limiters.idFromName(ip);
      let limiter = new RateLimiterClient(
        () => this.env.limiters.get(limiterId),
        (err) => {
          console.error("Rate limiter error for IP", ip, ":", err);
          // Don't close WebSocket immediately, just log the error
        }
      );
      
      let session = { 
        limiterId: limiterId.toString(), 
        limiter, 
        blockedMessages: [],
        lastSeen: Date.now(),
        ip: ip
      };
      
      // Serialize attachment for hibernation support
      webSocket.serializeAttachment({
        limiterId: limiterId.toString(),
        ip: ip,
        timestamp: Date.now()
      });
      
      this.sessions.set(webSocket, session);

      // Send current user list to new user
      for (let otherSession of this.sessions.values()) {
        if (otherSession.name) {
          session.blockedMessages.push(
            JSON.stringify({ joined: otherSession.name })
          );
        }
      }

      // Send message history (last 100 messages)
      try {
        let storage = await this.storage.list({ reverse: true, limit: 100 });
        let backlog = [...storage.values()];
        backlog.reverse();
        backlog.forEach((value) => {
          session.blockedMessages.push(value);
        });
      } catch (storageErr) {
        console.error("Error loading message history:", storageErr);
        // Continue without history if storage fails
      }
      
      console.log("Session established for IP:", ip);
      
    } catch (err) {
      console.error("Error in handleSession:", err);
      // Try to close gracefully
      try {
        webSocket.close(1011, "Session setup failed");
      } catch (closeErr) {
        console.error("Error closing WebSocket:", closeErr);
      }
    }
  }

  async webSocketMessage(webSocket, msg) {
    try {
      let session = this.sessions.get(webSocket);
      if (!session) {
        console.error("No session found for WebSocket");
        webSocket.close(1002, "No session found");
        return;
      }
      
      // Update last seen timestamp
      session.lastSeen = Date.now();
      
      if (session.quit) {
        console.log("Session marked as quit, closing WebSocket");
        webSocket.close(1000, "Session ended");
        return;
      }

      // Check rate limiting with error handling
      try {
        if (!session.limiter.checkLimit()) {
          webSocket.send(
            JSON.stringify({
              error: "Your IP is being rate-limited, please try again later.",
            })
          );
          return;
        }
      } catch (rateLimitErr) {
        console.error("Rate limit check error:", rateLimitErr);
        // Continue without rate limiting if it fails
      }

      let data;
      try {
        data = JSON.parse(msg);
      } catch (parseErr) {
        console.error("JSON parse error:", parseErr);
        webSocket.send(JSON.stringify({ error: "Invalid message format." }));
        return;
      }

      // Handle ping messages for keepalive
      if (data.type === "ping") {
        session.lastSeen = Date.now();
        try {
          webSocket.send(JSON.stringify({ type: "pong" }));
        } catch (pongErr) {
          console.error("Error sending pong:", pongErr);
        }
        return;
      }

      if (!session.name) {
        // Handle user name registration
        session.name = String(data.name || "anonymous").substring(0, 32);
        
        // Update serialized attachment
        webSocket.serializeAttachment({
          ...webSocket.deserializeAttachment(),
          name: session.name,
          timestamp: Date.now()
        });
        
        if (session.name.length === 0) {
          webSocket.send(JSON.stringify({ error: "Name cannot be empty." }));
          webSocket.close(1002, "Invalid name.");
          return;
        }
        
        // Send queued messages
        if (session.blockedMessages) {
          session.blockedMessages.forEach((queued) => {
            try {
              webSocket.send(queued);
            } catch (sendErr) {
              console.error("Error sending queued message:", sendErr);
            }
          });
          delete session.blockedMessages;
        }
        
        // Broadcast user joined
        this.broadcast({ joined: session.name });
        
        // Send ready signal
        webSocket.send(JSON.stringify({ ready: true }));
        
        console.log("User registered:", session.name);
        return;
      }

      // Handle regular message
      const message = String(data.message || "").substring(0, 256);
      if (message.length === 0) {
        webSocket.send(JSON.stringify({ error: "Message cannot be empty." }));
        return;
      }

      const messageData = { 
        name: session.name, 
        message: message,
        timestamp: Math.max(Date.now(), this.lastTimestamp + 1)
      };
      
      this.lastTimestamp = messageData.timestamp;
      const dataStr = JSON.stringify(messageData);
      
      // Broadcast message
      this.broadcast(dataStr);

      // Store message with error handling
      try {
        const key = new Date(messageData.timestamp).toISOString();
        await this.storage.put(key, dataStr);
      } catch (storageErr) {
        console.error("Error storing message:", storageErr);
        // Continue even if storage fails
      }
      
    } catch (err) {
      console.error("WebSocket message error:", err);
      try {
        webSocket.send(JSON.stringify({ error: "Internal server error." }));
      } catch (sendErr) {
        console.error("Error sending error message:", sendErr);
      }
    }
  }

  async closeOrErrorHandler(webSocket, code = 1000, reason = "Connection closed") {
    let session = this.sessions.get(webSocket) || {};
    console.log(`WebSocket closing for user: ${session.name || 'unknown'}, code: ${code}, reason: ${reason}`);
    
    session.quit = true;
    this.sessions.delete(webSocket);
    
    if (session.name) {
      this.broadcast({ quit: session.name });
    }
  }

  async webSocketClose(webSocket, code, reason) {
    await this.closeOrErrorHandler(webSocket, code, reason);
  }

  async webSocketError(webSocket, error) {
    console.error("WebSocket error:", error);
    await this.closeOrErrorHandler(webSocket, 1011, "WebSocket error");
  }

  broadcast(message) {
    if (typeof message !== "string") {
      message = JSON.stringify(message);
    }
    
    let quitters = [];
    this.sessions.forEach((session, webSocket) => {
      try {
        if (session.name && !session.quit) {
          // Update last seen when successfully sending
          session.lastSeen = Date.now();
          webSocket.send(message);
        } else if (!session.name && session.blockedMessages) {
          // Queue message for users who haven't registered yet
          session.blockedMessages.push(message);
        }
      } catch (err) {
        console.error(`Error sending message to ${session.name || 'unknown'}:`, err);
        session.quit = true;
        quitters.push(session);
        this.sessions.delete(webSocket);
      }
    });
    
    // Broadcast quit messages for failed sends
    quitters.forEach((quitter) => {
      if (quitter.name) {
        // Recursive call, but safe since we removed the quitter from sessions
        try {
          this.broadcast({ quit: quitter.name });
        } catch (broadcastErr) {
          console.error("Error broadcasting quit message:", broadcastErr);
        }
      }
    });
  }
}

export class RateLimiter {
  constructor(state, env) {
    this.nextAllowedTime = 0;
  }

  async fetch(request) {
    return await handleErrors(request, async () => {
      let now = Date.now() / 1000;
      this.nextAllowedTime = Math.max(now, this.nextAllowedTime);
      if (request.method == "POST") {
        this.nextAllowedTime += 5;
      }
      let cooldown = Math.max(0, this.nextAllowedTime - now - 20);
      return new Response(cooldown);
    });
  }
}

class RateLimiterClient {
  constructor(getLimiterStub, reportError) {
    this.getLimiterStub = getLimiterStub;
    this.reportError = reportError;
    this.limiter = getLimiterStub();
    this.inCooldown = false;
    this.failureCount = 0;
    this.maxFailures = 3;
  }

  checkLimit() {
    if (this.inCooldown) {
      return false;
    }
    
    // If we've had too many failures, just allow the request
    if (this.failureCount >= this.maxFailures) {
      console.warn("Rate limiter disabled due to repeated failures");
      return true;
    }
    
    this.inCooldown = true;
    this.callLimiter();
    return true;
  }

  async callLimiter() {
    try {
      let response;
      try {
        response = await this.limiter.fetch("https://dummy-url", {
          method: "POST",
        });
      } catch (err) {
        console.warn("Rate limiter fetch failed, retrying with new stub:", err.message);
        this.limiter = this.getLimiterStub();
        response = await this.limiter.fetch("https://dummy-url", {
          method: "POST",
        });
      }
      
      let cooldown = +(await response.text());
      if (isNaN(cooldown) || cooldown < 0) {
        cooldown = 1; // Default 1 second cooldown
      }
      
      // Cap cooldown at 10 seconds for better UX
      cooldown = Math.min(cooldown, 10);
      
      await new Promise((resolve) => setTimeout(resolve, cooldown * 1000));
      this.inCooldown = false;
      this.failureCount = 0; // Reset failure count on success
      
    } catch (err) {
      console.error("Rate limiter error:", err);
      this.failureCount++;
      this.inCooldown = false;
      
      if (this.failureCount < this.maxFailures) {
        // Try again with a shorter cooldown
        await new Promise((resolve) => setTimeout(resolve, 1000));
      } else {
        console.warn("Rate limiter disabled after", this.maxFailures, "failures");
        if (this.reportError) {
          this.reportError(err);
        }
      }
    }
  }
}
