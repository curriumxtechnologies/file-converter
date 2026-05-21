// ============================================================================
// File Converter - Main App (Frontend Only)
// ============================================================================

// Global state for converters
window.App = {
    // Shared utilities
    formatFileSize(bytes) {
        if (!bytes) return '0 Bytes';
        const u = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(1024));
        return (bytes / Math.pow(1024, i)).toFixed(2) + ' ' + u[i];
    },

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    },

    downloadBlob(blob, filename) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; 
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    },

    // Error handling
    showError(msg) {
        const el = document.getElementById('errorSection');
        const errorMsgEl = document.getElementById('errorMessage');
        if (el && errorMsgEl) {
            errorMsgEl.textContent = msg;
            el.style.display = 'block';
            clearTimeout(this._errorTimeout);
            this._errorTimeout = setTimeout(() => this.hideError(), 10000);
        } else {
            console.error('Error:', msg);
            alert(msg);
        }
    },

    hideError() {
        const el = document.getElementById('errorSection');
        if (el) el.style.display = 'none';
    },

    // Tabs
    switchTab(tabName) {
        const tabs = document.querySelectorAll('.tab-btn');
        const contents = document.querySelectorAll('.tab-content');
        
        tabs.forEach(b => b.classList.remove('active'));
        contents.forEach(c => c.classList.remove('active'));

        const btn = document.querySelector(`[data-tab="${tabName}"]`);
        const content = document.getElementById(`tab-${tabName}`);
        
        if (btn) btn.classList.add('active');
        if (content) content.classList.add('active');
        
        // Save current tab to localStorage
        localStorage.setItem('activeTab', tabName);
        console.log(`Switched to tab: ${tabName}`);
    },

    // Feedback modals
    showFeedbackModal() {
        const hasShown = localStorage.getItem('fileconv_feedback_shown');
        if (hasShown) return;

        const modal = document.getElementById('feedbackModal');
        if (!modal) return;
        
        const input = modal.querySelector('.modal-input');
        modal.style.display = 'flex';
        setTimeout(() => input?.focus(), 300);
    },

    showThankYouModal() {
        const modal = document.getElementById('thankYouModal');
        if (!modal) return;
        
        modal.style.display = 'flex';
        setTimeout(() => { 
            modal.style.display = 'none'; 
        }, 2500);
    }
};

// Stats storage
window.StatsStore = {
    getToday() {
        const today = new Date().toDateString();
        const stored = localStorage.getItem('fileconv_stats');
        if (stored) {
            try {
                const data = JSON.parse(stored);
                if (data.date === today) return data.count;
            } catch(e) {}
        }
        return 0;
    },
    
    increment(amount = 1) {
        const today = new Date().toDateString();
        const current = this.getToday();
        localStorage.setItem('fileconv_stats', JSON.stringify({
            date: today,
            count: current + amount
        }));
    }
};

// ============================================================================
// Initialize
// ============================================================================
document.addEventListener('DOMContentLoaded', () => {
    console.log('🚀 File Converter ready');
    console.log('🔍 SharedArrayBuffer support:', typeof SharedArrayBuffer !== 'undefined');
    console.log('🔒 Cross-origin isolated:', window.crossOriginIsolated);

    // Tab switching
    const tabBtns = document.querySelectorAll('.tab-btn');
    console.log(`Found ${tabBtns.length} tab buttons`);
    
    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const tabName = btn.getAttribute('data-tab');
            console.log(`Tab clicked: ${tabName}`);
            App.switchTab(tabName);
        });
    });
    
    // Restore last active tab
    const lastTab = localStorage.getItem('activeTab');
    console.log(`Last tab: ${lastTab}`);
    if (lastTab && ['heic', 'video'].includes(lastTab)) {
        App.switchTab(lastTab);
    } else {
        // Ensure HEIC tab is active by default
        App.switchTab('heic');
    }

    // Error close
    const errorCloseBtn = document.getElementById('errorCloseBtn');
    if (errorCloseBtn) {
        errorCloseBtn.addEventListener('click', () => App.hideError());
    }

    // Feedback modal
    const feedbackModal = document.getElementById('feedbackModal');
    const feedbackForm = document.getElementById('feedbackForm');
    const feedbackClose = document.getElementById('feedbackClose');
    
    if (feedbackModal && feedbackClose && feedbackForm) {
        feedbackClose.addEventListener('click', () => feedbackModal.style.display = 'none');
        feedbackModal.addEventListener('click', (e) => {
            if (e.target === feedbackModal) feedbackModal.style.display = 'none';
        });

        feedbackForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            try {
                const formData = new FormData(feedbackForm);
                await fetch(feedbackForm.action, {
                    method: 'POST',
                    body: formData,
                    headers: { 'Accept': 'application/json' }
                });
            } catch (err) { 
                console.warn('Feedback submission failed:', err);
            }
            feedbackModal.style.display = 'none';
            feedbackForm.reset();
            localStorage.setItem('fileconv_feedback_shown', 'true');
            App.showThankYouModal();
        });
    }

    // Thank you modal
    const thankYouModal = document.getElementById('thankYouModal');
    if (thankYouModal) {
        thankYouModal.addEventListener('click', (e) => {
            if (e.target === thankYouModal) thankYouModal.style.display = 'none';
        });
    }

    // Initialize Video Converter (from video-converter.js)
    if (typeof initVideoConverter === 'function') {
        console.log('🎥 Initializing video converter...');
        initVideoConverter();
    } else {
        console.warn('Video converter not loaded yet, waiting...');
        const checkVideoConverter = setInterval(() => {
            if (typeof initVideoConverter === 'function') {
                clearInterval(checkVideoConverter);
                initVideoConverter();
                console.log('✅ Video converter initialized');
            }
        }, 100);
        
        // Timeout after 5 seconds
        setTimeout(() => {
            clearInterval(checkVideoConverter);
            if (typeof initVideoConverter !== 'function') {
                console.error('Video converter failed to load');
            }
        }, 5000);
    }

    // Initialize HEIC Converter
    if (typeof HeicUIManager !== 'undefined' && typeof HeicAppState !== 'undefined') {
        const heicState = new HeicAppState();
        new HeicUIManager(heicState);
        console.log('✅ HEIC converter initialized');
    }

    // Update stats
    const todayCountEl = document.getElementById('todayCount');
    if (todayCountEl) {
        todayCountEl.textContent = window.StatsStore.getToday();
    }
    
    console.log('✅ App initialized');
});