let ws;
const chatMessages = document.getElementById("chatMessages");
const logsContent = document.getElementById("logsContent");
const messageInput = document.getElementById("messageInput");
const sendBtn = document.getElementById("sendBtn");
const statusText = document.getElementById("status-text");
const statusIndicator = document.getElementById("status-indicator");
const clearLogsBtn = document.getElementById("clearLogsBtn");

// Connect to WebSocket
function connectWebSocket() {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  ws = new WebSocket(`${protocol}//${window.location.host}`);

  ws.onopen = () => {
    statusText.textContent = "Connected";
    statusIndicator.classList.add("connected");
    logMessage("Connected to ElizaOS Agent", "info");
  };

  ws.onmessage = (event) => {
    const data = JSON.parse(event.data);

    if (data.type === "user-message") {
      addMessage(data.content, "assistant");
    } else if (data.type === "error") {
      logMessage(`Error: ${data.message}`, "error");
      addMessage(`❌ Error: ${data.message}`, "assistant");
    } else {
      logMessage(data.message, data.type);
    }
  };

  ws.onerror = (error) => {
    logMessage(`WebSocket error: ${error}`, "error");
  };

  ws.onclose = () => {
    statusText.textContent = "Disconnected";
    statusIndicator.classList.remove("connected");
    logMessage("Disconnected from server", "info");
    setTimeout(connectWebSocket, 3000);
  };
}

// Add message to chat
function addMessage(content, role) {
  const messageDiv = document.createElement("div");
  messageDiv.className = `message ${role}`;

  const avatar = document.createElement("div");
  avatar.className = "message-avatar";
  avatar.textContent = role === "user" ? "👤" : "🤖";

  const contentDiv = document.createElement("div");
  contentDiv.className = "message-content";
  contentDiv.textContent = content;

  messageDiv.appendChild(avatar);
  messageDiv.appendChild(contentDiv);
  chatMessages.appendChild(messageDiv);

  // Scroll to bottom
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

// Log message to terminal
function logMessage(message, type = "log") {
  const logEntry = document.createElement("div");
  logEntry.className = `log-entry ${type}`;
  
  const timestamp = new Date().toLocaleTimeString();
  
  let prefix = "";
  switch (type) {
    case "info":
      prefix = "ℹ️  ";
      break;
    case "tool":
      prefix = "🔧 ";
      break;
    case "response":
      prefix = "✅ ";
      break;
    case "error":
      prefix = "❌ ";
      break;
    default:
      prefix = "📝 ";
  }
  
  logEntry.textContent = `[${timestamp}] ${prefix}${message}`;
  logsContent.appendChild(logEntry);

  // Keep only last 100 logs
  while (logsContent.children.length > 100) {
    logsContent.removeChild(logsContent.firstChild);
  }

  // Scroll to bottom
  logsContent.scrollTop = logsContent.scrollHeight;
}

// Send message
function sendMessage() {
  const message = messageInput.value.trim();
  if (!message) return;

  // Add to chat
  addMessage(message, "user");
  logMessage(`User: ${message}`, "log");

  // Send to server
  ws.send(JSON.stringify({ text: message }));

  // Clear input
  messageInput.value = "";
  messageInput.focus();
}

// Event listeners
sendBtn.addEventListener("click", sendMessage);
messageInput.addEventListener("keypress", (e) => {
  if (e.key === "Enter") sendMessage();
});

clearLogsBtn.addEventListener("click", () => {
  logsContent.innerHTML = "";
  logMessage("Logs cleared", "info");
});

// Connect on load
window.addEventListener("DOMContentLoaded", connectWebSocket);
