// ============================================================================
// HEIC to PNG Converter - 100% Client-Side
// ============================================================================

const MAX_FILE_SIZE = 50 * 1024 * 1024;
const BULK_DOWNLOAD_THRESHOLD = 5;

// Simple localStorage-based stats
const StatsStore = {
    getTodayKey() {
        return `fileconv_stats_${new Date().toISOString().split('T')[0]}`;
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

// ============================================================================
// State Management
// ============================================================================
class AppState {
    constructor() {
        this.files = new Map();
        this.listeners = new Set();
        this.zipBlob = null;
        this.hasShownFeedback = false;
    }

    addFile(file) {
        const id = `${file.name}-${file.size}-${Date.now()}`;
        this.files.set(id, {
            id, file, status: 'pending', progress: 0,
            originalSize: file.size, convertedSize: null,
            error: null, convertedBlob: null, convertedName: null
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
// HEIC Converter
// ============================================================================
class HeicConverter {
    static async convertFile(file, fileId, state) {
        state.updateFile(fileId, { status: 'converting', progress: 30 });
        try {
            const result = await heic2any({ blob: file, toType: 'image/png', quality: 1.0 });
            const pngBlob = Array.isArray(result) ? result[0] : result;
            const outputName = file.name.replace(/\.(heic|heif)$/i, '.png');
            return { success: true, blob: pngBlob, name: outputName, size: pngBlob.size };
        } catch (error) {
            return { success: false, error: error.message || 'Conversion failed' };
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

        await Promise.all(Array(Math.min(CONCURRENCY, files.length)).fill(null).map(() => worker()));
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
// HEIC UI Manager
// ============================================================================
class HeicUIManager {
    constructor(state) {
        this.state = state;
        this.elements = this.cacheElements();
        this.initEventListeners();
        this.state.subscribe(this.render.bind(this));
    }

    cacheElements() {
        return {
            uploadZone: document.getElementById('heicUploadZone'),
            fileInput: document.getElementById('heicFileInput'),
            filesSection: document.getElementById('heicFilesSection'),
            filesGrid: document.getElementById('heicFilesGrid'),
            fileCount: document.getElementById('heicFileCount'),
            clearBtn: document.getElementById('heicClearBtn'),
            convertBtn: document.getElementById('heicConvertBtn'),
            downloadAllSection: document.getElementById('heicDownloadAll')
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

        this.elements.clearBtn.addEventListener('click', () => {
            if (this.state.getAllFiles().length && confirm('Clear all files?')) {
                this.state.clearAll();
            }
        });

        this.elements.convertBtn.addEventListener('click', () => this.handleConvert());
    }

    handleFileSelect(fileList) {
        const heicFiles = Array.from(fileList).filter(f => {
            const ext = f.name.split('.').pop()?.toLowerCase();
            return ext === 'heic' || ext === 'heif';
        });
        if (!heicFiles.length) {
            App.showError('Please select HEIC/HEIF files only.');
            return;
        }
        const oversized = heicFiles.filter(f => f.size > MAX_FILE_SIZE);
        if (oversized.length) {
            App.showError(`Files exceeding 50MB: ${oversized.map(f => f.name).join(', ')}`);
        }
        heicFiles.filter(f => f.size <= MAX_FILE_SIZE).forEach(f => this.state.addFile(f));
        App.hideError();
    }

    async handleConvert() {
        const pending = this.state.getPendingFiles();
        if (!pending.length) { App.showError('No files to convert.'); return; }

        const count = pending.length;
        this.elements.convertBtn.disabled = true;
        this.elements.convertBtn.innerHTML = '<span class="spinner"></span> Converting...';

        try {
            const startTime = performance.now();
            const results = await HeicConverter.convertAll(pending, this.state, (progress) => {
                this.elements.convertBtn.innerHTML = `<span class="spinner"></span> ${progress}%`;
            });

            const elapsed = ((performance.now() - startTime) / 1000).toFixed(1);
            const successCount = results.filter(r => r.result.success).length;
            console.log(`✅ ${successCount}/${count} converted in ${elapsed}s`);

            results.forEach(({ fileData, result }) => {
                if (result.success) {
                    this.state.updateFile(fileData.id, {
                        status: 'success', progress: 100,
                        convertedBlob: result.blob, convertedName: result.name, convertedSize: result.size
                    });
                } else {
                    this.state.updateFile(fileData.id, { status: 'error', progress: 100, error: result.error });
                }
            });

            if (successCount > 1) {
                const successFiles = results.filter(r => r.result.success)
                    .map(r => ({ name: r.result.name, blob: r.result.blob }));
                this.state.zipBlob = await HeicConverter.createZip(successFiles);
            }

            StatsStore.increment(successCount);
            document.getElementById('todayCount').textContent = StatsStore.getToday();

            if (successCount === 1) {
                const f = results.find(r => r.result.success);
                if (f) setTimeout(() => App.downloadBlob(f.result.blob, f.result.name), 500);
            } else if (successCount > BULK_DOWNLOAD_THRESHOLD && this.state.zipBlob) {
                setTimeout(() => App.downloadBlob(this.state.zipBlob, `converted_${successCount}_images.zip`), 800);
            }

            if (successCount > 0) setTimeout(() => App.showFeedbackModal(), 1500);

        } catch (error) {
            pending.forEach(f => this.state.updateFile(f.id, { status: 'error', progress: 100, error: error.message }));
            App.showError('Conversion failed.');
        } finally {
            this.elements.convertBtn.disabled = false;
            this.elements.convertBtn.innerHTML = `Convert All`;
        }
    }

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
            if (dBtn) dBtn.onclick = () => App.downloadBlob(f.convertedBlob, f.convertedName);
            const rBtn = document.getElementById(`rm-${f.id}`);
            if (rBtn) rBtn.onclick = () => this.state.removeFile(f.id);
        });

        const successCount = files.filter(f => f.status === 'success').length;
        if (successCount > 1 && this.state.zipBlob) {
            this.elements.downloadAllSection.innerHTML = `
                <div class="bulk-download-card">
                    <div><strong>📦 ${successCount} files ready</strong></div>
                    <button class="btn btn-primary btn-large" id="heicDownloadAllBtn">Download All as ZIP</button>
                </div>`;
            this.elements.downloadAllSection.classList.remove('hidden');
            document.getElementById('heicDownloadAllBtn').onclick = () => App.downloadBlob(this.state.zipBlob, `converted_${successCount}_images.zip`);
        } else if (successCount > 0) {
            this.elements.downloadAllSection.innerHTML = `<p class="text-center text-gray-600 text-sm">✅ ${successCount} file(s) ready</p>`;
            this.elements.downloadAllSection.classList.remove('hidden');
        } else {
            this.elements.downloadAllSection.classList.add('hidden');
        }

        this.elements.convertBtn.disabled = !files.some(f => f.status === 'pending');
    }

    renderFileItem(f) {
        const icons = { pending: '📄', converting: '⏳', success: '✅', error: '❌' };
        const labels = { pending: 'Ready', converting: '...', success: 'Done', error: 'Failed' };
        const width = f.status === 'converting' ? '50%' : f.status !== 'pending' ? '100%' : '0%';
        let action = '';
        if (f.status === 'success') {
            action = (this.state.getSuccessFiles().length <= BULK_DOWNLOAD_THRESHOLD || !this.state.zipBlob)
                ? `<button class="btn btn-primary btn-small" id="dl-${f.id}">Download</button>`
                : '<span class="badge badge-success">In ZIP</span>';
        } else if (f.status === 'error') {
            action = `<button class="btn btn-secondary btn-small" id="rm-${f.id}">✕</button>`;
        } else if (f.status === 'converting') {
            action = '<span class="spinner"></span>';
        }
        return `
            <div class="file-item status-${f.status}">
                <div class="file-icon">${icons[f.status]}</div>
                <div class="file-info">
                    <div class="file-name">${App.escapeHtml(f.file.name)}</div>
                    <div class="file-meta">
                        <span>${App.formatFileSize(f.originalSize)}</span>
                        ${f.convertedSize ? `<span>→ ${App.formatFileSize(f.convertedSize)}</span>` : ''}
                        <span class="file-status ${f.status}">${labels[f.status]}</span>
                    </div>
                    ${f.status !== 'pending' ? `<div class="file-progress"><div class="file-progress-bar" style="width:${width}"></div></div>` : ''}
                </div>
                <div class="file-actions">${action}</div>
            </div>`;
    }
}