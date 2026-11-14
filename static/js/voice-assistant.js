// RasoiLink Multilingual Voice Ordering & Speech Assistant
// Supports speech recognition in 8 Bharat languages and voice speech feedback

class RasoiVoiceAssistant {
  constructor() {
    this.recognition = null;
    this.isListening = false;
    this.synth = window.speechSynthesis || null;
    this.initRecognition();
  }

  initRecognition() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      console.warn('[RasoiVoiceAssistant] Web Speech API not supported on this browser.');
      return;
    }

    this.recognition = new SpeechRecognition();
    this.recognition.continuous = false;
    this.recognition.interimResults = true;

    this.recognition.onstart = () => {
      this.isListening = true;
      this.updateVoiceUI(true, window.t('listening', 'Listening...'));
    };

    this.recognition.onresult = (event) => {
      let interimTranscript = '';
      let finalTranscript = '';

      for (let i = event.resultIndex; i < event.results.length; ++i) {
        if (event.results[i].isFinal) {
          finalTranscript += event.results[i][0].transcript;
        } else {
          interimTranscript += event.results[i][0].transcript;
        }
      }

      const transcript = finalTranscript || interimTranscript;
      this.updateTranscriptText(transcript);

      if (finalTranscript) {
        this.processVoiceCommand(finalTranscript);
      }
    };

    this.recognition.onerror = (event) => {
      console.warn('[RasoiVoiceAssistant] Error:', event.error);
      this.isListening = false;
      this.updateVoiceUI(false, 'Tap mic to speak');
    };

    this.recognition.onend = () => {
      this.isListening = false;
      this.updateVoiceUI(false);
    };
  }

  toggle() {
    if (!this.recognition) {
      alert("Voice search is not supported on this browser. Please try Chrome, Edge, or Safari.");
      return;
    }

    if (this.isListening) {
      this.recognition.stop();
    } else {
      const currentLang = window.getCurrentLanguage ? window.getCurrentLanguage() : 'en';
      const speechMeta = window.BHARAT_LANGUAGES ? window.BHARAT_LANGUAGES[currentLang] : null;
      this.recognition.lang = speechMeta ? speechMeta.speechLang : 'en-IN';
      try {
        this.recognition.start();
        this.showVoiceModal();
      } catch (e) {
        console.warn('Voice start exception:', e);
      }
    }
  }

  processVoiceCommand(text) {
    const lower = text.toLowerCase().trim();
    console.log('[RasoiVoiceAssistant] Spoken text:', lower);

    // 1. Check Cart / Checkout
    if (lower.includes('checkout') || lower.includes('cart') || lower.includes('tray') || lower.includes('bill') || lower.includes('थाली') || lower.includes('बिल')) {
      if (typeof openCartDrawer === 'function') {
        openCartDrawer();
      } else if (typeof openCartModal === 'function') {
        openCartModal();
      }
      this.speak("Opening your tray for checkout.");
      this.hideVoiceModal(1200);
      return;
    }

    // 2. Check Veg Only Filter
    if (lower.includes('veg') || lower.includes('शाकाहारी') || lower.includes('શાકાહારી')) {
      if (typeof applyQuickFilter === 'function') {
        applyQuickFilter('veg');
      } else {
        const vegFilterBtn = document.getElementById('filterVegBtn');
        if (vegFilterBtn && !vegFilterBtn.classList.contains('active')) {
          vegFilterBtn.click();
        }
      }
      this.speak("Showing pure vegetarian dishes.");
      this.hideVoiceModal(1200);
      return;
    }

    // 3. Check Eco Saver / Waste-to-Profit Deals
    if (lower.includes('deal') || lower.includes('offer') || lower.includes('eco') || lower.includes('waste') || lower.includes('ऑफर') || lower.includes('छूट')) {
      const ecoSection = document.getElementById('ecoSaverDealsSection');
      if (ecoSection) {
        ecoSection.scrollIntoView({ behavior: 'smooth' });
      }
      this.speak("Showing AI Eco-Saver Flash Deals.");
      this.hideVoiceModal(1200);
      return;
    }

    // 4. Check Group Hunger Pool
    if (lower.includes('group') || lower.includes('pool') || lower.includes('hostel') || lower.includes('ग्रुप')) {
      if (typeof openGroupHungerModal === 'function') openGroupHungerModal();
      this.speak("Opening Group Hunger Network for pooled discounts.");
      this.hideVoiceModal(1200);
      return;
    }

    // 5. Quantity + Dish matching (e.g., "Do cutting chai add karo", "Add 2 pav bhaji", "Samosa chaat add")
    const qtyMatch = lower.match(/(\d+|ek|do|teen|chaar|two|three|four|one)\s*(.+)/);
    let qty = 1;
    let queryDish = lower;

    if (qtyMatch) {
      const qtyWord = qtyMatch[1];
      if (qtyWord === 'do' || qtyWord === 'two' || qtyWord === '2') qty = 2;
      else if (qtyWord === 'teen' || qtyWord === 'three' || qtyWord === '3') qty = 3;
      else if (qtyWord === 'chaar' || qtyWord === 'four' || qtyWord === '4') qty = 4;
      else if (qtyWord === 'ek' || qtyWord === 'one' || qtyWord === '1') qty = 1;
      else if (!isNaN(parseInt(qtyWord))) qty = parseInt(qtyWord);

      queryDish = qtyMatch[2].replace('add', '').replace('karo', '').replace('daalo', '').replace('chahiye', '').trim();
    } else {
      queryDish = lower.replace('add', '').replace('karo', '').replace('daalo', '').replace('search', '').replace('khojo', '').trim();
    }

    // Find best match in window.menuItemsList
    const items = window.menuItemsList || [];
    let matchedItem = null;

    for (const item of items) {
      const itemName = item.name.toLowerCase();
      const itemDesc = (item.description || '').toLowerCase();
      if (itemName.includes(queryDish) || queryDish.includes(itemName) ||
         (queryDish.length >= 4 && (itemName.includes(queryDish.slice(0, 4)) || itemDesc.includes(queryDish)))) {
        matchedItem = item;
        break;
      }
    }

    // Secondary keyword check for common Indian items
    if (!matchedItem) {
      if (lower.includes('chai') || lower.includes('tea') || lower.includes('चाय')) {
        matchedItem = items.find(i => i.id === 1) || items[0];
      } else if (lower.includes('pav bhaji') || lower.includes('bhaji')) {
        matchedItem = items.find(i => i.id === 6);
      } else if (lower.includes('biryani')) {
        matchedItem = items.find(i => i.id === 17);
      } else if (lower.includes('samosa')) {
        matchedItem = items.find(i => i.id === 9);
      } else if (lower.includes('chole bhature') || lower.includes('bhature')) {
        matchedItem = items.find(i => i.id === 14);
      } else if (lower.includes('kulfi') || lower.includes('gulab jamun') || lower.includes('meetha')) {
        matchedItem = items.find(i => i.id === 20);
      }
    }

    if (matchedItem) {
      if (lower.includes('add') || lower.includes('daalo') || lower.includes('karo') || lower.includes('chahiye') || qtyMatch) {
        if (typeof addToCart === 'function') {
          for (let q = 0; q < qty; q++) {
            addToCart(matchedItem.id);
          }
        }
        this.speak(`Added ${qty} ${matchedItem.name} to your tray!`);
      } else {
        // Just search
        const searchInput = document.getElementById('searchInput') || document.getElementById('menuSearchInput');
        if (searchInput) {
          searchInput.value = matchedItem.name;
          searchInput.dispatchEvent(new Event('input'));
          if (typeof handleSearchInput === 'function') handleSearchInput(searchInput.value);
        }
        this.speak(`Found ${matchedItem.name}`);
      }
    } else {
      // General search filter
      const searchInput = document.getElementById('searchInput') || document.getElementById('menuSearchInput');
      if (searchInput) {
        searchInput.value = queryDish;
        searchInput.dispatchEvent(new Event('input'));
        if (typeof handleSearchInput === 'function') handleSearchInput(searchInput.value);
      }
      this.speak(`Searching menu for ${queryDish}`);
    }

    this.hideVoiceModal(1600);
  }

  speak(text) {
    if (!this.synth) return;
    try {
      this.synth.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 1.0;
      utterance.pitch = 1.0;
      this.synth.speak(utterance);
    } catch (e) {
      console.warn('Speech synthesis error:', e);
    }
  }

  showVoiceModal() {
    let modal = document.getElementById('voiceAssistantModal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'voiceAssistantModal';
      modal.className = 'fixed inset-0 z-50 bg-stone-900/60 backdrop-blur-md flex items-end sm:items-center justify-center p-4 transition-all duration-300';
      modal.innerHTML = `
        <div class="w-full max-w-md bg-white border border-stone-200 rounded-3xl p-6 shadow-2xl text-center space-y-4">
          <div class="flex items-center justify-between pb-2 border-b border-stone-100">
            <span class="text-xs font-extrabold tracking-wider text-brand-700 uppercase flex items-center gap-1.5">
              <span class="w-2 h-2 rounded-full bg-red-500 animate-ping"></span>
              <span id="voiceModalTitle">${window.t('voice_assistant_title', 'RasoiLink Voice Assistant')}</span>
            </span>
            <button onclick="window.rasoiVoice.closeModal()" class="w-7 h-7 rounded-full bg-stone-100 hover:bg-stone-200 text-stone-500 flex items-center justify-center text-xs">✕</button>
          </div>

          <div class="py-4">
            <div id="voicePulsingRing" class="w-20 h-20 rounded-full bg-orange-100 border-4 border-brand-500 text-brand-600 flex items-center justify-center mx-auto shadow-lg animate-pulse">
              <i data-lucide="mic" class="w-8 h-8"></i>
            </div>
          </div>

          <div class="space-y-1">
            <p id="voiceLiveStatus" class="text-xs font-bold text-stone-400 uppercase tracking-widest">${window.t('listening', 'Listening...')}</p>
            <p id="voiceTranscriptText" class="text-base font-extrabold text-stone-900 min-h-[1.75rem] font-sans">“Say: Do cutting chai add karo”</p>
          </div>

          <p class="text-[11px] text-stone-500 pt-1 border-t border-stone-100 leading-relaxed">
            ${window.t('voice_instruction', "Try saying: 'Do cutting chai add karo', 'Show biryani', or 'Checkout'")}
          </p>
        </div>
      `;
      document.body.appendChild(modal);
      if (window.lucide) window.lucide.createIcons();
    }
    modal.classList.remove('hidden');
    modal.style.display = 'flex';
  }

  updateVoiceUI(isListening, statusText = '') {
    const statusEl = document.getElementById('voiceLiveStatus');
    const ringEl = document.getElementById('voicePulsingRing');
    if (statusEl) statusEl.textContent = statusText || (isListening ? 'Listening...' : 'Ready');
    if (ringEl) {
      if (isListening) {
        ringEl.classList.add('animate-pulse', 'border-brand-500', 'bg-orange-100');
        ringEl.classList.remove('border-stone-300', 'bg-stone-100');
      } else {
        ringEl.classList.remove('animate-pulse', 'border-brand-500', 'bg-orange-100');
        ringEl.classList.add('border-stone-300', 'bg-stone-100');
      }
    }
  }

  updateTranscriptText(text) {
    const transcriptEl = document.getElementById('voiceTranscriptText');
    if (transcriptEl && text) {
      transcriptEl.textContent = `“${text}”`;
    }
  }

  closeModal() {
    if (this.recognition && this.isListening) {
      this.recognition.stop();
    }
    this.hideVoiceModal(0);
  }

  hideVoiceModal(delayMs = 0) {
    setTimeout(() => {
      const modal = document.getElementById('voiceAssistantModal');
      if (modal) {
        modal.classList.add('hidden');
        modal.style.display = 'none';
      }
    }, delayMs);
  }
}

// Global instance
window.rasoiVoice = new RasoiVoiceAssistant();
window.toggleVoiceAssistant = () => window.rasoiVoice.toggle();
