// ============================================================================
// HEIC to PNG Converter - 100% Client-Side
// ============================================================================

const MAX_FILE_SIZE = 50 * 1024 * 1024;
const BULK_DOWNLOAD_THRESHOLD = 5;

// Remove duplicate StatsStore and use global one from app.js
if (typeof window.StatsStore === 'undefined') {
    window.StatsStore = {
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
}

// ============================================================================
// State Management
// ============================================================================
class HeicAppState {
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
        if (fd) { 
            Object.assign(fd, updates); 
            this.notify(); 
        }
    }

    removeFile(id) { 
        this.files.delete(id); 
        this.notify(); 
    }

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

    notify() { 
        this.listeners.forEach(fn => fn(this.getAllFiles())); 
    }
}

// ============================================================================
// HEIC Converter
// ============================================================================
class HeicConverter {
    static async loadHeic2Any() {
        // Check if heic2any is already loaded
        if (typeof window.heic2any !== 'undefined') {
            return window.heic2any;
        }
        
        // Dynamically load heic2any from CDN
        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = 'https://cdn.jsdelivr.net/npm/heic2any@0.0.4/dist/heic2any.min.js';
            script.onload = () => {
                if (typeof window.heic2any !== 'undefined') {
                    resolve(window.heic2any);
                } else {
                    reject(new Error('heic2any failed to load'));
                }
            };
            script.onerror = () => reject(new Error('Failed to load heic2any library'));
            document.head.appendChild(script);
        });
    }

    static async convertFile(file, fileId, state) {
        state.updateFile(fileId, { status: 'converting', progress: 30 });
        try {
            // Ensure heic2any is loaded
            const heic2any = await this.loadHeic2Any();
            
            const result = await heic2any({ 
                blob: file, 
                toType: 'image/png', 
                quality: 0.9 
            });
            
            const pngBlob = Array.isArray(result) ? result[0] : result;
            const outputName = file.name.replace(/\.(heic|heif)$/i, '.png');
            
            state.updateFile(fileId, { progress: 100 });
            
            return { 
                success: true, 
                blob: pngBlob, 
                name: outputName, 
                size: pngBlob.size 
            };
        } catch (error) {
            console.error('HEIC conversion error:', error);
            let errorMessage = error.message || 'Conversion failed';
            
            // User-friendly error messages
            if (errorMessage.includes('Unsupported') || errorMessage.includes('HEIC')) {
                errorMessage = 'This file may be corrupted or not a valid HEIC image.';
            } else if (errorMessage.includes('memory')) {
                errorMessage = 'File is too large to process in browser memory.';
            }
            
            return { success: false, error: errorMessage };
        }
    }

    static async convertAll(files, state, onProgress) {
        const results = [];
        let completed = 0;
        const CONCURRENCY = Math.min(navigator.hardwareConcurrency || 4, 3); // Limit to 3 to avoid memory issues
        const queue = [...files];
        
        const worker = async () => {
            while (queue.length > 0) {
                const fileData = queue.shift();
                if (!fileData) break;
                
                const result = await this.convertFile(fileData.file, fileData.id, state);
                results.push({ fileData, result });
                completed++;
                
                if (onProgress) {
                    onProgress(Math.round((completed / files.length) * 100));
                }
            }
        };

        await Promise.all(Array(Math.min(CONCURRENCY, files.length)).fill(null).map(() => worker()));
        return results;
    }

    static async createZip(files) {
        try {
            // Dynamically import JSZip
            const JSZipModule = await import('https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js');
            const JSZip = JSZipModule.default || JSZipModule;
            const zip = new JSZip();
            
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
        } catch (error) {
            console.error('ZIP creation error:', error);
            throw new Error('Failed to create ZIP file');
        }
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
        if (!this.elements.uploadZone) {
            console.warn('HEIC upload zone not found');
            return;
        }
        
        this.elements.uploadZone.addEventListener('click', () => {
            if (this.elements.fileInput) this.elements.fileInput.click();
        });
        
        if (this.elements.fileInput) {
            this.elements.fileInput.addEventListener('change', (e) => {
                this.handleFileSelect(e.target.files);
                e.target.value = '';
            });
        }

        ['dragover', 'dragleave', 'drop'].forEach(evt => {
            this.elements.uploadZone.addEventListener(evt, (e) => {
                e.preventDefault();
                if (evt === 'dragover') {
                    this.elements.uploadZone.classList.add('drag-over');
                }
                if (evt === 'dragleave') {
                    this.elements.uploadZone.classList.remove('drag-over');
                }
                if (evt === 'drop') {
                    this.elements.uploadZone.classList.remove('drag-over');
                    this.handleFileSelect(e.dataTransfer.files);
                }
            });
        });

        if (this.elements.clearBtn) {
            this.elements.clearBtn.addEventListener('click', () => {
                if (this.state.getAllFiles().length && confirm('Clear all files?')) {
                    this.state.clearAll();
                }
            });
        }

        if (this.elements.convertBtn) {
            this.elements.convertBtn.addEventListener('click', () => this.handleConvert());
        }
    }

    handleFileSelect(fileList) {
        if (!fileList || fileList.length === 0) return;
        
        const heicFiles = Array.from(fileList).filter(f => {
            const ext = f.name.split('.').pop()?.toLowerCase();
            return ext === 'heic' || ext === 'heif';
        });
        
        if (!heicFiles.length) {
            if (window.App && window.App.showError) {
                window.App.showError('Please select HEIC/HEIF files only.');
            } else {
                alert('Please select HEIC/HEIF files only.');
            }
            return;
        }
        
        const oversized = heicFiles.filter(f => f.size > MAX_FILE_SIZE);
        if (oversized.length && window.App) {
            window.App.showError(`Files exceeding 50MB: ${oversized.map(f => f.name).join(', ')}`);
        }
        
        heicFiles.filter(f => f.size <= MAX_FILE_SIZE).forEach(f => this.state.addFile(f));
        
        if (window.App && window.App.hideError) {
            window.App.hideError();
        }
    }

    async handleConvert() {
        const pending = this.state.getPendingFiles();
        if (!pending.length) {
            if (window.App) window.App.showError('No files to convert.');
            return;
        }

        const originalBtnHTML = this.elements.convertBtn.innerHTML;
        this.elements.convertBtn.disabled = true;
        this.elements.convertBtn.innerHTML = '<span class="spinner"></span> Loading converter...';

        try {
            // Pre-load heic2any library
            await HeicConverter.loadHeic2Any();
            
            this.elements.convertBtn.innerHTML = '<span class="spinner"></span> Converting...';
            const startTime = performance.now();
            
            const results = await HeicConverter.convertAll(pending, this.state, (progress) => {
                this.elements.convertBtn.innerHTML = `<span class="spinner"></span> ${progress}%`;
            });

            const elapsed = ((performance.now() - startTime) / 1000).toFixed(1);
            const successCount = results.filter(r => r.result.success).length;

            results.forEach(({ fileData, result }) => {
                if (result.success) {
                    this.state.updateFile(fileData.id, {
                        status: 'success', progress: 100,
                        convertedBlob: result.blob, convertedName: result.name, convertedSize: result.size
                    });
                } else {
                    this.state.updateFile(fileData.id, { 
                        status: 'error', progress: 100, 
                        error: result.error 
                    });
                }
            });

            // Create ZIP if multiple files converted successfully
            if (successCount > 1) {
                const successFiles = results.filter(r => r.result.success)
                    .map(r => ({ name: r.result.name, blob: r.result.blob }));
                this.state.zipBlob = await HeicConverter.createZip(successFiles);
            }

            // Update stats
            if (window.StatsStore) {
                window.StatsStore.increment(successCount);
                const todayCountEl = document.getElementById('todayCount');
                if (todayCountEl) {
                    todayCountEl.textContent = window.StatsStore.getToday();
                }
            }

            // Auto-download for single file
            if (successCount === 1) {
                const f = results.find(r => r.result.success);
                if (f && window.App) {
                    setTimeout(() => window.App.downloadBlob(f.result.blob, f.result.name), 500);
                }
            } 
            // Auto-download ZIP for bulk conversions
            else if (successCount > BULK_DOWNLOAD_THRESHOLD && this.state.zipBlob && window.App) {
                setTimeout(() => window.App.downloadBlob(this.state.zipBlob, `converted_${successCount}_images.zip`), 800);
            }

            // Show feedback modal
            if (successCount > 0 && window.App) {
                setTimeout(() => window.App.showFeedbackModal(), 1500);
            }
            
            console.log(`✅ Converted ${successCount}/${successCount + results.filter(r => !r.result.success).length} files in ${elapsed}s`);

        } catch (error) {
            console.error('Batch conversion error:', error);
            pending.forEach(f => this.state.updateFile(f.id, { 
                status: 'error', progress: 100, 
                error: error.message || 'Conversion failed' 
            }));
            if (window.App) window.App.showError('Conversion failed. Please try again.');
        } finally {
            this.elements.convertBtn.disabled = false;
            this.elements.convertBtn.innerHTML = originalBtnHTML;
        }
    }

    render(files) {
        if (!this.elements.filesSection) return;
        
        // Show/hide files section
        if (files.length) {
            this.elements.filesSection.style.display = 'block';
            if (this.elements.fileCount) this.elements.fileCount.textContent = files.length;
        } else {
            this.elements.filesSection.style.display = 'none';
        }

        // Render file grid
        if (this.elements.filesGrid) {
            this.elements.filesGrid.innerHTML = files.map(f => this.renderFileItem(f)).join('');
        }
        
        // Attach event listeners to rendered buttons
        files.forEach(f => {
            const dBtn = document.getElementById(`dl-${f.id}`);
            if (dBtn && window.App) {
                dBtn.onclick = () => window.App.downloadBlob(f.convertedBlob, f.convertedName);
            }
            const rBtn = document.getElementById(`rm-${f.id}`);
            if (rBtn) {
                rBtn.onclick = () => this.state.removeFile(f.id);
            }
        });

        // Handle download all section
        const successCount = files.filter(f => f.status === 'success').length;
        if (this.elements.downloadAllSection) {
            if (successCount > 1 && this.state.zipBlob) {
                this.elements.downloadAllSection.innerHTML = `
                    <div class="bulk-download-card">
                        <div><strong>📦 ${successCount} files ready</strong></div>
                        <button class="btn btn-primary btn-large" id="heicDownloadAllBtn">Download All as ZIP</button>
                    </div>`;
                this.elements.downloadAllSection.classList.remove('hidden');
                const downloadBtn = document.getElementById('heicDownloadAllBtn');
                if (downloadBtn && window.App) {
                    downloadBtn.onclick = () => window.App.downloadBlob(this.state.zipBlob, `converted_${successCount}_images.zip`);
                }
            } else if (successCount > 0) {
                this.elements.downloadAllSection.innerHTML = `<p class="text-center text-gray-600 text-sm">✅ ${successCount} file(s) ready</p>`;
                this.elements.downloadAllSection.classList.remove('hidden');
            } else {
                this.elements.downloadAllSection.classList.add('hidden');
            }
        }

        // Enable/disable convert button
        if (this.elements.convertBtn) {
            this.elements.convertBtn.disabled = !files.some(f => f.status === 'pending');
        }
    }

    renderFileItem(f) {
        const icons = { pending: '📄', converting: '⏳', success: '✅', error: '❌' };
        const labels = { pending: 'Ready', converting: 'Converting...', success: 'Done', error: 'Failed' };
        const width = f.status === 'converting' ? '50%' : f.status !== 'pending' ? '100%' : '0%';
        
        let action = '';
        if (f.status === 'success') {
            const shouldShowIndividualDownload = this.state.getSuccessFiles().length <= BULK_DOWNLOAD_THRESHOLD || !this.state.zipBlob;
            if (shouldShowIndividualDownload) {
                action = `<button class="btn btn-primary btn-small" id="dl-${f.id}">Download</button>`;
            } else {
                action = '<span class="badge badge-success">In ZIP</span>';
            }
        } else if (f.status === 'error') {
            action = `<button class="btn btn-secondary btn-small" id="rm-${f.id}">✕</button>`;
        } else if (f.status === 'converting') {
            action = '<span class="spinner"></span>';
        } else {
            action = `<button class="btn btn-secondary btn-small" id="rm-${f.id}">✕</button>`;
        }
        
        const errorHtml = f.error ? `<div class="error-message">⚠️ ${window.App ? window.App.escapeHtml(f.error) : f.error}</div>` : '';
        
        return `
            <div class="file-item status-${f.status}">
                <div class="file-icon">${icons[f.status]}</div>
                <div class="file-info">
                    <div class="file-name">${window.App ? window.App.escapeHtml(f.file.name) : f.file.name}</div>
                    <div class="file-meta">
                        <span>${window.App ? window.App.formatFileSize(f.originalSize) : f.originalSize} bytes</span>
                        ${f.convertedSize ? `<span>→ ${window.App ? window.App.formatFileSize(f.convertedSize) : f.convertedSize} bytes</span>` : ''}
                        <span class="file-status ${f.status}">${labels[f.status]}</span>
                    </div>
                    ${f.status !== 'pending' ? `<div class="file-progress"><div class="file-progress-bar" style="width:${width}"></div></div>` : ''}
                    ${errorHtml}
                </div>
                <div class="file-actions">${action}</div>
            </div>`;
    }
}

// Export for global use
if (typeof window !== 'undefined') {
    window.HeicAppState = HeicAppState;
    window.HeicConverter = HeicConverter;
    window.HeicUIManager = HeicUIManager;
}