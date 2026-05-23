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

    // Tabs with smooth transitions
    switchTab(tabName) {
        const tabs = document.querySelectorAll('.tab-btn');
        
        // Get the currently active tab
        const currentActiveContent = document.querySelector('.tab-content.active');
        const targetContent = document.getElementById(`tab-${tabName}`);
        
        if (!targetContent) return;
        
        // If already active, do nothing
        if (currentActiveContent === targetContent) return;
        
        // Update tab buttons with smooth transition
        tabs.forEach(b => {
            if (b.getAttribute('data-tab') === tabName) {
                b.classList.add('active');
            } else {
                b.classList.remove('active');
            }
        });
        
        // Smooth content transition
        if (currentActiveContent) {
            // Fade out current content
            currentActiveContent.style.opacity = '0';
            currentActiveContent.style.transform = 'translateY(10px)';
            
            // After fade out, switch content
            setTimeout(() => {
                currentActiveContent.classList.remove('active');
                currentActiveContent.style.display = 'none';
                
                // Show and fade in new content
                targetContent.style.display = 'block';
                targetContent.classList.add('active');
                
                // Trigger reflow for transition to work
                targetContent.offsetHeight;
                
                // Fade in
                targetContent.style.opacity = '1';
                targetContent.style.transform = 'translateY(0)';
            }, 200);
        } else {
            // No current content, just show target
            targetContent.style.display = 'block';
            targetContent.classList.add('active');
            targetContent.style.opacity = '1';
            targetContent.style.transform = 'translateY(0)';
        }
        
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
        setTimeout(() => {
            modal.style.opacity = '1';
            if (input) input.focus();
        }, 50);
    },

    showThankYouModal() {
        const modal = document.getElementById('thankYouModal');
        if (!modal) return;
        
        modal.style.display = 'flex';
        modal.style.opacity = '1';
        setTimeout(() => { 
            modal.style.opacity = '0';
            setTimeout(() => {
                modal.style.display = 'none';
            }, 300);
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
    console.log('File Converter ready');
    console.log('SharedArrayBuffer support:', typeof SharedArrayBuffer !== 'undefined');
    console.log('Cross-origin isolated:', window.crossOriginIsolated);

    // ========================================================================
    // FIX: Properly initialize tab content visibility
    // ========================================================================
    const tabContents = document.querySelectorAll('.tab-content');
    let hasActiveContent = false;
    
    // First pass: apply base styles and check for active content
    tabContents.forEach(content => {
        content.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
        
        if (content.classList.contains('active')) {
            // Active tab should be visible
            content.style.display = 'block';
            content.style.opacity = '1';
            content.style.transform = 'translateY(0)';
            hasActiveContent = true;
            console.log('Found active tab:', content.id);
        } else {
            // Inactive tabs start hidden
            content.style.display = 'none';
            content.style.opacity = '0';
            content.style.transform = 'translateY(10px)';
        }
    });
    
    // If no tab has active class, activate the first one
    if (!hasActiveContent && tabContents.length > 0) {
        const firstContent = tabContents[0];
        firstContent.classList.add('active');
        firstContent.style.display = 'block';
        firstContent.style.opacity = '1';
        firstContent.style.transform = 'translateY(0)';
        console.log('No active tab found, activating first tab:', firstContent.id);
        
        // Also update corresponding tab button
        const firstTabBtn = document.querySelector('.tab-btn');
        if (firstTabBtn) {
            firstTabBtn.classList.add('active');
        }
    }

    // ========================================================================
    // Tab switching with smooth transitions
    // ========================================================================
    const tabBtns = document.querySelectorAll('.tab-btn');
    console.log(`Found ${tabBtns.length} tab buttons`);
    
    // Ripple effect function (defined here so it can access event)
    function createRippleEffect(button, event) {
        const ripple = document.createElement('span');
        ripple.classList.add('ripple');
        ripple.style.cssText = `
            position: absolute;
            border-radius: 50%;
            background: rgba(255, 255, 255, 0.4);
            transform: scale(0);
            animation: ripple 0.6s ease-out;
            pointer-events: none;
        `;
        
        const rect = button.getBoundingClientRect();
        const size = Math.max(rect.width, rect.height);
        ripple.style.width = ripple.style.height = `${size}px`;
        ripple.style.left = `${event.clientX - rect.left - size / 2}px`;
        ripple.style.top = `${event.clientY - rect.top - size / 2}px`;
        
        button.style.position = 'relative';
        button.style.overflow = 'hidden';
        button.appendChild(ripple);
        setTimeout(() => ripple.remove(), 600);
    }
    
    tabBtns.forEach(btn => {
        btn.style.transition = 'all 0.3s ease';
        
        btn.addEventListener('click', (event) => {
            const tabName = btn.getAttribute('data-tab');
            console.log(`Tab clicked: ${tabName}`);
            
            // Add ripple effect
            createRippleEffect(btn, event);
            
            App.switchTab(tabName);
        });
    });
    
    // Restore last active tab from localStorage
    const lastTab = localStorage.getItem('activeTab');
    console.log(`Last tab from storage: ${lastTab}`);
    
    if (lastTab && ['heic', 'video'].includes(lastTab)) {
        // Use setTimeout to ensure DOM is ready, but don't hide existing content
        setTimeout(() => {
            App.switchTab(lastTab);
        }, 50);
    } else {
        // Ensure HEIC tab is active by default (only if not already active)
        const activeTab = document.querySelector('.tab-content.active');
        if (!activeTab || activeTab.id !== 'tab-heic') {
            setTimeout(() => {
                App.switchTab('heic');
            }, 50);
        }
    }

    // ========================================================================
    // Error handling with fade
    // ========================================================================
    const errorCloseBtn = document.getElementById('errorCloseBtn');
    if (errorCloseBtn) {
        errorCloseBtn.addEventListener('click', () => App.hideError());
    }
    
    // Close error on click outside (optional)
    const errorSection = document.getElementById('errorSection');
    if (errorSection) {
        errorSection.addEventListener('click', (e) => {
            if (e.target === errorSection) {
                App.hideError();
            }
        });
    }

    // ========================================================================
    // Feedback modal with smooth transitions
    // ========================================================================
    const feedbackModal = document.getElementById('feedbackModal');
    const feedbackForm = document.getElementById('feedbackForm');
    const feedbackClose = document.getElementById('feedbackClose');
    
    if (feedbackModal && feedbackClose && feedbackForm) {
        feedbackModal.style.transition = 'opacity 0.3s ease';
        
        feedbackClose.addEventListener('click', () => {
            feedbackModal.style.opacity = '0';
            setTimeout(() => {
                feedbackModal.style.display = 'none';
            }, 300);
        });
        
        feedbackModal.addEventListener('click', (e) => {
            if (e.target === feedbackModal) {
                feedbackModal.style.opacity = '0';
                setTimeout(() => {
                    feedbackModal.style.display = 'none';
                }, 300);
            }
        });

        feedbackForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            try {
                const formData = new FormData(feedbackForm);
                const response = await fetch(feedbackForm.action, {
                    method: 'POST',
                    body: formData,
                    headers: { 'Accept': 'application/json' }
                });
                if (!response.ok) throw new Error('Network response was not ok');
            } catch (err) { 
                console.warn('Feedback submission failed:', err);
            }
            feedbackModal.style.opacity = '0';
            setTimeout(() => {
                feedbackModal.style.display = 'none';
                feedbackForm.reset();
            }, 300);
            localStorage.setItem('fileconv_feedback_shown', 'true');
            App.showThankYouModal();
        });
    }

    // ========================================================================
    // Thank you modal
    // ========================================================================
    const thankYouModal = document.getElementById('thankYouModal');
    if (thankYouModal) {
        thankYouModal.style.transition = 'opacity 0.3s ease';
        thankYouModal.addEventListener('click', (e) => {
            if (e.target === thankYouModal) {
                thankYouModal.style.opacity = '0';
                setTimeout(() => {
                    thankYouModal.style.display = 'none';
                }, 300);
            }
        });
    }

    // ========================================================================
    // Initialize Video Converter
    // ========================================================================
    if (typeof initVideoConverter === 'function') {
        console.log('Initializing video converter...');
        initVideoConverter();
    } else {
        console.warn('Video converter not loaded yet, waiting...');
        let attempts = 0;
        const checkVideoConverter = setInterval(() => {
            attempts++;
            if (typeof initVideoConverter === 'function') {
                clearInterval(checkVideoConverter);
                initVideoConverter();
                console.log('Video converter initialized');
            } else if (attempts >= 50) { // 5 seconds max
                clearInterval(checkVideoConverter);
                console.error('Video converter failed to load after 5 seconds');
            }
        }, 100);
    }

    // ========================================================================
    // Initialize HEIC Converter
    // ========================================================================
    if (typeof HeicUIManager !== 'undefined' && typeof HeicAppState !== 'undefined') {
        const heicState = new HeicAppState();
        new HeicUIManager(heicState);
        console.log('HEIC converter initialized');
    } else {
        console.warn('HEIC converter dependencies not found');
    }

    // ========================================================================
    // Update stats display
    // ========================================================================
    const todayCountEl = document.getElementById('todayCount');
    if (todayCountEl) {
        const todayCount = window.StatsStore.getToday();
        todayCountEl.textContent = todayCount;
        console.log(`Today's conversions: ${todayCount}`);
    }
    
    // ========================================================================
    // Add CSS animation for ripple if not already present
    // ========================================================================
    if (!document.querySelector('#ripple-keyframes-style')) {
        const style = document.createElement('style');
        style.id = 'ripple-keyframes-style';
        style.textContent = `
            @keyframes ripple {
                to {
                    transform: scale(4);
                    opacity: 0;
                }
            }
        `;
        document.head.appendChild(style);
    }
    
    console.log('App fully initialized');
});