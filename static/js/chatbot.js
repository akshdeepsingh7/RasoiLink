/**
 * RasoiLink Floating AI Ordering & FAQ Chatbot Widget
 * Powered by Groq API with Tailwind CSS & speech synthesis
 */

(function() {
  const ChatState = {
    isOpen: false,
    history: [],
    isSending: false,
    voiceEnabled: false
  };

  document.addEventListener('DOMContentLoaded', () => {
    initChatbotUI();
  });

  function initChatbotUI() {
    const trigger = document.getElementById('chatTriggerBtn');
    const closeBtn = document.getElementById('chatCloseBtn');
    const sendBtn = document.getElementById('chatSendBtn');
    const input = document.getElementById('chatInput');
    const voiceToggle = document.getElementById('btnVoiceToggle');

    if (trigger) trigger.addEventListener('click', toggleChatWindow);
    if (closeBtn) closeBtn.addEventListener('click', toggleChatWindow);
    if (sendBtn) sendBtn.addEventListener('click', () => sendUserMessage());
    if (input) {
      input.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') sendUserMessage();
      });
    }

    if (voiceToggle) {
      voiceToggle.addEventListener('click', () => {
        ChatState.voiceEnabled = !ChatState.voiceEnabled;
        voiceToggle.innerHTML = ChatState.voiceEnabled 
          ? '<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>' 
          : '<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>';
        if (ChatState.voiceEnabled) speakText("Voice enabled! What would you like to order today?");
      });
    }

    appendBotMessage(
      "Welcome to RasoiLink! I am your AI dining concierge. Inquire about dishes, request items to your order tray, or apply promotional discounts.",
      []
    );
  }

  function toggleChatWindow() {
    ChatState.isOpen = !ChatState.isOpen;
    const win = document.getElementById('chatWindow');
    if (win) {
      if (ChatState.isOpen) {
        win.classList.remove('scale-90', 'translate-y-8', 'opacity-0', 'pointer-events-none');
        win.classList.add('scale-100', 'translate-y-0', 'opacity-100', 'pointer-events-auto');
        const input = document.getElementById('chatInput');
        if (input) setTimeout(() => input.focus(), 300);
      } else {
        win.classList.add('scale-90', 'translate-y-8', 'opacity-0', 'pointer-events-none');
        win.classList.remove('scale-100', 'translate-y-0', 'opacity-100', 'pointer-events-auto');
      }
    }
  }

  // Expose toggleChatWindow globally so mobile bottom navigation can activate it
  window.toggleChatWindow = toggleChatWindow;

  function speakText(text) {
    if (!ChatState.voiceEnabled || !window.speechSynthesis) return;
    try {
      window.speechSynthesis.cancel();
      const clean = text.replace(/[*_#`]/g, '');
      const utterance = new SpeechSynthesisUtterance(clean);
      utterance.rate = 1.0;
      utterance.pitch = 1.0;
      window.speechSynthesis.speak(utterance);
    } catch (e) {
      // Speech synthesis error handled gracefully
    }
  }

  async function sendUserMessage(textOverride = null) {
    if (ChatState.isSending) return;

    const input = document.getElementById('chatInput');
    const userText = (textOverride || (input ? input.value : '')).trim();
    if (!userText) return;

    if (input) input.value = '';

    appendUserMessage(userText);
    ChatState.history.push({ sender: 'user', text: userText });

    ChatState.isSending = true;
    const typingIndicator = appendTypingIndicator();

    try {
      const currentCart = window.RasoiCart ? window.RasoiCart.getCartSummary() : [];
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: userText,
          history: ChatState.history,
          current_cart: currentCart
        })
      });

      typingIndicator.remove();

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const data = await res.json();
      const botReply = data.message || "I've updated your request!";
      const actions = data.actions || [];

      appendBotMessage(botReply, actions);
      ChatState.history.push({ sender: 'bot', text: botReply });
      speakText(botReply);

      executeChatActions(actions);
    } catch (err) {
      console.error('Chatbot error:', err);
      if (typingIndicator) typingIndicator.remove();
      appendBotMessage("Aiyyo, looks like our kitchen network had a hiccup! Please try again or tap the menu directly.", []);
    } finally {
      ChatState.isSending = false;
    }
  }

  function executeChatActions(actions) {
    if (!actions || !Array.isArray(actions) || !window.RasoiCart) return;

    actions.forEach(act => {
      if (act.action === 'ADD_ITEM' && act.item_id) {
        window.RasoiCart.addItem(act.item_id, act.quantity || 1);
      } else if (act.action === 'REMOVE_ITEM' && act.item_id) {
        window.RasoiCart.removeItem(act.item_id);
      } else if (act.action === 'APPLY_COUPON' && act.code) {
        window.RasoiCart.applyCoupon(act.code);
      } else if (act.action === 'SET_SCHEDULE' && act.date && act.time_slot) {
        window.RasoiCart.setSchedule(act.date, act.time_slot);
      }
    });
  }

  function appendUserMessage(text) {
    const body = document.getElementById('chatBody');
    if (!body) return;

    const msg = document.createElement('div');
    msg.className = 'bg-brand-600 text-white p-3 rounded-2xl rounded-br-sm shadow-sm max-w-[85%] self-end font-medium leading-relaxed';
    msg.textContent = text;
    body.appendChild(msg);
    body.scrollTop = body.scrollHeight;
  }

  function appendBotMessage(text, actions = []) {
    const body = document.getElementById('chatBody');
    if (!body) return;

    const msg = document.createElement('div');
    msg.className = 'bg-white text-stone-800 p-3 rounded-2xl rounded-bl-sm border border-stone-200/90 shadow-sm max-w-[85%] self-start space-y-1.5 leading-relaxed';

    const formatted = text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    let html = `<div>${formatted}</div>`;

    if (actions && actions.length > 0) {
      actions.forEach(a => {
        if (a.action === 'ADD_ITEM') {
          html += `
            <div class="bg-stone-50 border border-stone-200 rounded-xl p-2 flex items-center justify-between gap-2 mt-1">
              <div>
                <div class="font-extrabold text-stone-900">${a.item_name || 'Dish'}</div>
                <div class="text-[10px] text-stone-500">Added x${a.quantity || 1} to tray</div>
              </div>
              <button onclick="window.RasoiCart.addItem(${a.item_id}, 1)" class="bg-brand-600 hover:bg-brand-700 text-white text-[10px] font-extrabold px-2.5 py-1 rounded-full shadow-sm transition-all">+ Add</button>
            </div>
          `;
        } else if (a.action === 'APPLY_COUPON') {
          html += `<div class="inline-flex items-center gap-1.5 bg-emerald-50 border border-emerald-300 text-emerald-700 px-2.5 py-0.5 rounded-full text-[10px] font-extrabold"><span class="w-1.5 h-1.5 rounded-full bg-emerald-500"></span><span>Code: ${a.code}</span></div>`;
        } else if (a.action === 'SET_SCHEDULE') {
          html += `<div class="inline-flex items-center gap-1.5 bg-sky-50 border border-sky-300 text-sky-700 px-2.5 py-0.5 rounded-full text-[10px] font-extrabold"><span class="w-1.5 h-1.5 rounded-full bg-sky-500"></span><span>Scheduled: ${a.time_slot}</span></div>`;
        }
      });
    }

    msg.innerHTML = html;
    body.appendChild(msg);
    body.scrollTop = body.scrollHeight;
  }

  function appendTypingIndicator() {
    const body = document.getElementById('chatBody');
    const msg = document.createElement('div');
    msg.className = 'bg-white text-stone-800 p-2.5 rounded-2xl rounded-bl-sm border border-stone-200 shadow-sm self-start flex items-center gap-1.5';
    msg.innerHTML = `
      <span class="w-1.5 h-1.5 bg-brand-600 rounded-full animate-bounce"></span>
      <span class="w-1.5 h-1.5 bg-brand-600 rounded-full animate-bounce [animation-delay:0.2s]"></span>
      <span class="w-1.5 h-1.5 bg-brand-600 rounded-full animate-bounce [animation-delay:0.4s]"></span>
      <span class="text-[10px] text-stone-500 ml-1 font-medium">Thinking...</span>
    `;
    body.appendChild(msg);
    body.scrollTop = body.scrollHeight;
    return msg;
  }

  window.sendQuickPrompt = function(promptText) {
    sendUserMessage(promptText);
  };
})();
