// ============================================================================
// HEIC to PNG Converter - 100% Client-Side
// No server, no API, no uploads. Everything happens in your browser.
// ============================================================================

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB
const BULK_DOWNLOAD_THRESHOLD = 5;

// Simple localStorage-based stats (no server needed)
const StatsStore = {
    getTodayKey() {
        return `heic_stats_${new Date().toISOString().split('T')[0]}`;
    },
    increment(count) {
        const key = this.getTodayKey();
        const current = parseInt(localStorage.getItem(key) || '0');
        localStorage.setItem(key, current + count);
        return current + count;
    },
    getToday() {
        return parseInt(localStorage.getItem(this.getTodayKey()) || '0');
    }
};

console.log('🚀 HEIC to PNG Converter — Client Side');
console.log('🔒 Files never leave your device');

// ============================================================================
// State Management
// ============================================================================
class AppState {
    constructor() {
        this.files = new Map();
        this.listeners = new Set();
        this.zipBlob = null;
        this.hasShownFeedback = false; // Track if feedback was shown this session
    }

    addFile(file) {
        const id = `${file.name}-${file.size}-${Date.now()}`;
        this.files.set(id, {
            id,
            file,
            status: 'pending',
            progress: 0,
            originalSize: file.size,
            convertedSize: null,
            error: null,
            convertedBlob: null,
            convertedName: null
        });
        this.notify();
        return id;
    }

    updateFile(id, updates) {
        const fd = this.files.get(id);
        if (fd) { Object.assign(fd, updates); this.notify(); }
    }

    removeFile(id) { this.files.delete(id); this.notify(); }

    clearAll() {
        this.files.clear();
        this.zipBlob = null;
        this.notify();
    }

    getFile(id) { return this.files.get(id); }
    getAllFiles() { return Array.from(this.files.values()); }
    getPendingFiles() { return this.getAllFiles().filter(f => f.status === 'pending'); }
    getSuccessFiles() { return this.getAllFiles().filter(f => f.status === 'success'); }

    subscribe(fn) {
        this.listeners.add(fn);
        return () => this.listeners.delete(fn);
    }

    notify() { this.listeners.forEach(fn => fn(this.getAllFiles())); }
}

// ============================================================================
// HEIC Converter - 100% Client-Side
// ============================================================================
class HeicConverter {
    static async convertFile(file, fileId, state) {
        console.log(`🔄 Converting: ${file.name}`);
        state.updateFile(fileId, { status: 'converting', progress: 30 });

        try {
            const result = await heic2any({
                blob: file,
                toType: 'image/png',
                quality: 1.0
            });

            const pngBlob = Array.isArray(result) ? result[0] : result;
            const outputName = file.name.replace(/\.(heic|heif)$/i, '.png');

            console.log(`✅ Done: ${outputName} (${(pngBlob.size / 1024).toFixed(1)}KB)`);

            return {
                success: true,
                blob: pngBlob,
                name: outputName,
                size: pngBlob.size
            };
        } catch (error) {
            console.error(`❌ Failed: ${file.name}`, error);
            return {
                success: false,
                error: error.message || 'Conversion failed'
            };
        }
    }

    static async convertAll(files, state, updateProgress) {
        const results = [];
        let completed = 0;

        const CONCURRENCY = navigator.hardwareConcurrency || 4;
        const queue = [...files];

        const worker = async () => {
            while (queue.length > 0) {
                const fileData = queue.shift();
                if (!fileData) break;

                const result = await this.convertFile(fileData.file, fileData.id, state);
                results.push({ fileData, result });
                completed++;
                updateProgress(Math.round((completed / files.length) * 100));
            }
        };

        const workers = Array(Math.min(CONCURRENCY, files.length))
            .fill(null)
            .map(() => worker());

        await Promise.all(workers);
        return results;
    }

    static async createZip(files) {
        const JSZip = await import('https://cdn.jsdelivr.net/npm/jszip@3.10.1/+esm');
        const zip = new JSZip.default();

        const usedNames = new Set();
        files.forEach(f => {
            let name = f.name;
            if (usedNames.has(name)) {
                const base = name.replace('.png', '');
                let counter = 1;
                while (usedNames.has(`${base}_${counter}.png`)) counter++;
                name = `${base}_${counter}.png`;
            }
            usedNames.add(name);
            zip.file(name, f.blob);
        });

        return await zip.generateAsync({ type: 'blob' });
    }
}

// ============================================================================
// UI Manager
// ============================================================================
class UIManager {
    constructor(state) {
        this.state = state;
        this.elements = this.cacheElements();
        this.initEventListeners();
        this.state.subscribe(this.render.bind(this));
        this.updateStats();
        this.initFeedbackModals();
    }

    cacheElements() {
        return {
            uploadZone: document.getElementById('uploadZone'),
            fileInput: document.getElementById('fileInput'),
            filesSection: document.getElementById('filesSection'),
            filesGrid: document.getElementById('filesGrid'),
            fileCount: document.getElementById('fileCount'),
            clearAllBtn: document.getElementById('clearAllBtn'),
            convertBtn: document.getElementById('convertBtn'),
            errorSection: document.getElementById('errorSection'),
            errorMessage: document.getElementById('errorMessage'),
            errorCloseBtn: document.getElementById('errorCloseBtn'),
            todayCount: document.getElementById('todayCount'),
            downloadAllSection: document.getElementById('downloadAllSection')
        };
    }

    initEventListeners() {
        this.elements.uploadZone.addEventListener('click', () => this.elements.fileInput.click());
        this.elements.fileInput.addEventListener('change', (e) => {
            this.handleFileSelect(e.target.files);
            e.target.value = '';
        });

        ['dragover', 'dragleave', 'drop'].forEach(evt => {
            this.elements.uploadZone.addEventListener(evt, (e) => {
                e.preventDefault();
                if (evt === 'dragover') this.elements.uploadZone.classList.add('drag-over');
                if (evt === 'dragleave') this.elements.uploadZone.classList.remove('drag-over');
                if (evt === 'drop') {
                    this.elements.uploadZone.classList.remove('drag-over');
                    this.handleFileSelect(e.dataTransfer.files);
                }
            });
        });

        this.elements.clearAllBtn.addEventListener('click', () => {
            if (this.state.getAllFiles().length && confirm('Clear all files?')) {
                this.state.clearAll();
            }
        });

        this.elements.convertBtn.addEventListener('click', () => this.handleConvert());
        this.elements.errorCloseBtn.addEventListener('click', () => this.hideError());

        document.addEventListener('dragover', e => e.preventDefault());
        document.addEventListener('drop', e => e.preventDefault());
    }

    // ==========================================================================
    // Feedback Modals
    // ==========================================================================
    initFeedbackModals() {
        // Feedback modal
        const feedbackModal = document.getElementById('feedbackModal');
        const feedbackForm = document.getElementById('feedbackForm');
        const feedbackClose = document.getElementById('feedbackClose');
        const feedbackInput = feedbackModal?.querySelector('.modal-input');

        if (feedbackClose) {
            feedbackClose.addEventListener('click', () => {
                feedbackModal.style.display = 'none';
            });
        }

        if (feedbackModal) {
            feedbackModal.addEventListener('click', (e) => {
                if (e.target === feedbackModal) {
                    feedbackModal.style.display = 'none';
                }
            });
        }

        if (feedbackForm) {
            feedbackForm.addEventListener('submit', async (e) => {
                e.preventDefault();
                const formData = new FormData(feedbackForm);
                const submitBtn = feedbackForm.querySelector('button[type="submit"]');

                // Show loading state
                const originalHTML = submitBtn.innerHTML;
                submitBtn.innerHTML = '<span class="spinner"></span> Sending...';
                submitBtn.disabled = true;

                try {
                    await fetch(feedbackForm.action, {
                        method: 'POST',
                        body: formData,
                        headers: { 'Accept': 'application/json' }
                    });
                } catch (error) {
                    console.log('Formspree may be unavailable, but continuing...');
                }

                // Hide feedback modal
                feedbackModal.style.display = 'none';
                feedbackForm.reset();
                submitBtn.innerHTML = originalHTML;
                submitBtn.disabled = false;

                // Show thank you modal
                this.showThankYouModal();

                // Remember that we showed feedback
                this.state.hasShownFeedback = true;
                localStorage.setItem('heic_feedback_shown', 'true');
            });
        }

        // Thank you modal
        const thankYouModal = document.getElementById('thankYouModal');
        if (thankYouModal) {
            thankYouModal.addEventListener('click', (e) => {
                if (e.target === thankYouModal) {
                    thankYouModal.style.display = 'none';
                }
            });
        }

        // Check if feedback was already shown this session
        this.state.hasShownFeedback = localStorage.getItem('heic_feedback_shown') === 'true';
    }

    showFeedbackModal() {
        // Only show once per session
        if (this.state.hasShownFeedback) return;
        
        const modal = document.getElementById('feedbackModal');
        const input = modal?.querySelector('.modal-input');
        
        if (modal) {
            modal.style.display = 'flex';
            if (input) {
                setTimeout(() => input.focus(), 300);
            }
        }
    }

    showThankYouModal() {
        const modal = document.getElementById('thankYouModal');
        if (modal) {
            modal.style.display = 'flex';
            // Auto-hide after 2.5 seconds
            setTimeout(() => {
                modal.style.display = 'none';
            }, 2500);
        }
    }

    // ==========================================================================
    // File Handling
    // ==========================================================================
    handleFileSelect(fileList) {
        const heicFiles = Array.from(fileList).filter(f => {
            const ext = f.name.split('.').pop()?.toLowerCase();
            return ext === 'heic' || ext === 'heif';
        });

        if (!heicFiles.length) {
            this.showError('Please select HEIC/HEIF files only.');
            return;
        }

        console.log(`📁 Selected ${heicFiles.length} file(s)`);

        const oversized = heicFiles.filter(f => f.size > MAX_FILE_SIZE);
        if (oversized.length) {
            this.showError(`Files exceeding 50MB: ${oversized.map(f => f.name).join(', ')}`);
        }

        heicFiles.filter(f => f.size <= MAX_FILE_SIZE)
            .forEach(f => this.state.addFile(f));
        this.hideError();

        setTimeout(() => {
            this.elements.filesSection.scrollIntoView({ behavior: 'smooth' });
        }, 100);
    }

    // ==========================================================================
    // Conversion
    // ==========================================================================
    async handleConvert() {
        const pending = this.state.getPendingFiles();
        if (!pending.length) {
            this.showError('No files to convert.');
            return;
        }

        const count = pending.length;
        console.log(`🔄 Converting ${count} file(s)...`);

        this.elements.convertBtn.disabled = true;
        this.elements.convertBtn.innerHTML = '<span class="spinner"></span> Converting...';

        try {
            const startTime = performance.now();

            const results = await HeicConverter.convertAll(
                pending,
                this.state,
                (progress) => {
                    this.elements.convertBtn.innerHTML = `<span class="spinner"></span> ${progress}%`;
                }
            );

            const elapsed = ((performance.now() - startTime) / 1000).toFixed(1);
            const successCount = results.filter(r => r.result.success).length;

            console.log(`✅ ${successCount}/${count} converted in ${elapsed}s`);

            results.forEach(({ fileData, result }) => {
                if (result.success) {
                    this.state.updateFile(fileData.id, {
                        status: 'success',
                        progress: 100,
                        convertedBlob: result.blob,
                        convertedName: result.name,
                        convertedSize: result.size
                    });
                } else {
                    this.state.updateFile(fileData.id, {
                        status: 'error',
                        progress: 100,
                        error: result.error
                    });
                }
            });

            if (successCount > 1) {
                const successFiles = results
                    .filter(r => r.result.success)
                    .map(r => ({ name: r.result.name, blob: r.result.blob }));
                this.state.zipBlob = await HeicConverter.createZip(successFiles);
            }

            StatsStore.increment(successCount);
            this.updateStats();

            // Auto-download
            if (successCount === 1) {
                const f = results.find(r => r.result.success);
                if (f) {
                    setTimeout(() => this.downloadBlob(f.result.blob, f.result.name), 500);
                }
            } else if (successCount > BULK_DOWNLOAD_THRESHOLD && this.state.zipBlob) {
                setTimeout(() => {
                    this.downloadBlob(this.state.zipBlob, `converted_${successCount}_images.zip`);
                }, 800);
            }

            this.hideError();

            // Show feedback modal after successful conversion
            if (successCount > 0) {
                setTimeout(() => this.showFeedbackModal(), 1500);
            }

        } catch (error) {
            console.error('❌ Conversion failed:', error);
            pending.forEach(f => this.state.updateFile(f.id, {
                status: 'error', progress: 100, error: error.message
            }));
            this.showError('Conversion failed. Please try again.');
        } finally {
            this.elements.convertBtn.disabled = false;
            this.elements.convertBtn.innerHTML = `
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                    <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
                Convert All
            `;
        }
    }

    // ==========================================================================
    // Download
    // ==========================================================================
    downloadBlob(blob, filename) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        console.log(`💾 Downloaded: ${filename}`);
    }

    downloadAllAsZip() {
        if (this.state.zipBlob) {
            const count = this.state.getSuccessFiles().length;
            this.downloadBlob(this.state.zipBlob, `converted_${count}_images.zip`);
        }
    }

    // ==========================================================================
    // UI Helpers
    // ==========================================================================
    updateStats() {
        this.elements.todayCount.textContent = StatsStore.getToday();
    }

    showError(msg) {
        this.elements.errorMessage.textContent = msg;
        this.elements.errorSection.style.display = 'block';
        clearTimeout(this._errorTimeout);
        this._errorTimeout = setTimeout(() => this.hideError(), 10000);
    }

    hideError() {
        this.elements.errorSection.style.display = 'none';
    }

    formatFileSize(bytes) {
        if (!bytes) return '0 Bytes';
        const u = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(1024));
        return (bytes / Math.pow(1024, i)).toFixed(2) + ' ' + u[i];
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // ==========================================================================
    // Render
    // ==========================================================================
    render(files) {
        if (files.length) {
            this.elements.filesSection.style.display = 'block';
            this.elements.fileCount.textContent = files.length;
        } else {
            this.elements.filesSection.style.display = 'none';
        }

        this.elements.filesGrid.innerHTML = files.map(f => this.renderFileItem(f)).join('');

        files.forEach(f => {
            const dBtn = document.getElementById(`dl-${f.id}`);
            if (dBtn) dBtn.onclick = () => this.downloadBlob(f.convertedBlob, f.convertedName);
            const rBtn = document.getElementById(`rm-${f.id}`);
            if (rBtn) rBtn.onclick = () => this.state.removeFile(f.id);
        });

        const successCount = files.filter(f => f.status === 'success').length;
        const showZip = successCount > 1 && this.state.zipBlob;

        if (showZip) {
            this.elements.downloadAllSection.innerHTML = `
                <div class="bulk-download-card">
                    <div><strong>📦 ${successCount} files ready</strong></div>
                    <button class="btn btn-primary btn-large" id="downloadAllBtn">
                        Download All as ZIP
                    </button>
                </div>`;
            this.elements.downloadAllSection.classList.remove('hidden');
            document.getElementById('downloadAllBtn').onclick = () => this.downloadAllAsZip();
        } else if (successCount > 0) {
            this.elements.downloadAllSection.innerHTML = `
                <p class="text-center text-gray-600 text-sm">✅ ${successCount} file(s) ready — click Download above</p>`;
            this.elements.downloadAllSection.classList.remove('hidden');
        } else {
            this.elements.downloadAllSection.classList.add('hidden');
        }

        this.elements.convertBtn.disabled = !files.some(f => f.status === 'pending');
    }

    renderFileItem(f) {
        const icons = { pending: '📄', converting: '⏳', success: '✅', error: '❌' };
        const labels = { pending: 'Ready', converting: 'Converting...', success: 'Done', error: 'Failed' };
        const barClass = f.status === 'success' ? 'complete' : f.status === 'error' ? 'error' : '';
        const width = f.status === 'converting' ? '50%' : f.status !== 'pending' ? '100%' : '0%';

        let action = '';
        if (f.status === 'success') {
            if (this.state.getSuccessFiles().length <= BULK_DOWNLOAD_THRESHOLD || !this.state.zipBlob) {
                action = `<button class="btn btn-primary btn-small" id="dl-${f.id}">Download</button>`;
            } else {
                action = '<span class="badge badge-success">In ZIP</span>';
            }
        } else if (f.status === 'error') {
            action = `<button class="btn btn-secondary btn-small" id="rm-${f.id}">✕</button>`;
        } else if (f.status === 'converting') {
            action = '<span class="spinner"></span>';
        }

        return `
            <div class="file-item status-${f.status}">
                <div class="file-icon">${icons[f.status]}</div>
                <div class="file-info">
                    <div class="file-name">${this.escapeHtml(f.file.name)}</div>
                    <div class="file-meta">
                        <span>${this.formatFileSize(f.originalSize)}</span>
                        ${f.convertedSize ? `<span>→ ${this.formatFileSize(f.convertedSize)}</span>` : ''}
                        <span class="file-status ${f.status}">${labels[f.status]}</span>
                    </div>
                    ${f.status !== 'pending' ? `<div class="file-progress"><div class="file-progress-bar ${barClass}" style="width:${width}"></div></div>` : ''}
                </div>
                <div class="file-actions">${action}</div>
            </div>`;
    }
}

// ============================================================================
// Initialize
// ============================================================================
document.addEventListener('DOMContentLoaded', () => {
    console.log('✅ Converter ready — No server needed');
    const state = new AppState();
    new UIManager(state);

    document.addEventListener('paste', (e) => {
        const items = e.clipboardData?.items;
        if (!items) return;
        const files = [];
        for (const item of items) {
            if (item.kind === 'file') {
                const file = item.getAsFile();
                const ext = file.name.split('.').pop()?.toLowerCase();
                if (ext === 'heic' || ext === 'heif') files.push(file);
            }
        }
        if (files.length) {
            e.preventDefault();
            const input = document.getElementById('fileInput');
            const dt = new DataTransfer();
            files.forEach(f => dt.items.add(f));
            input.files = dt.files;
            input.dispatchEvent(new Event('change'));
        }
    });
});