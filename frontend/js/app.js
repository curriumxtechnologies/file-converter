// Configuration
const isDevelopment = window.location.hostname === 'localhost' || 
                      window.location.hostname === '127.0.0.1' ||
                      window.location.port === '5500' ||
                      window.location.port === '3000';

const API_BASE_URL = isDevelopment 
    ? 'http://127.0.0.1:8000'
    : window.location.origin;

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB
const BULK_DOWNLOAD_THRESHOLD = 5; // Files > 5 always download as ZIP

console.log(`🔧 API Base URL: ${API_BASE_URL}`);
console.log(`📡 Running in ${isDevelopment ? 'development' : 'production'} mode`);
console.log(`📦 Bulk download threshold: ${BULK_DOWNLOAD_THRESHOLD}+ files = ZIP`);

// State Management
class AppState {
    constructor() {
        this.files = new Map();
        this.listeners = new Set();
        this.batchZipBlob = null;
    }

    addFile(file) {
        const id = this.generateFileId(file);
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
        const fileData = this.files.get(id);
        if (fileData) {
            Object.assign(fileData, updates);
            this.notify();
        }
    }

    removeFile(id) {
        this.files.delete(id);
        this.notify();
    }

    clearAll() {
        this.files.clear();
        this.batchZipBlob = null;
        this.notify();
    }

    getFile(id) {
        return this.files.get(id);
    }

    getAllFiles() {
        return Array.from(this.files.values());
    }

    getPendingFiles() {
        return this.getAllFiles().filter(f => f.status === 'pending');
    }

    getSuccessFiles() {
        return this.getAllFiles().filter(f => f.status === 'success');
    }

    subscribe(listener) {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    notify() {
        this.listeners.forEach(listener => listener(this.getAllFiles()));
    }

    generateFileId(file) {
        return `${file.name}-${file.size}-${file.lastModified}`;
    }
}

// API Client
class ApiClient {
    static async uploadFiles(files) {
        const formData = new FormData();
        
        // Add all files to form data
        files.forEach(fileData => {
            formData.append('files', fileData.file);
        });

        const fileCount = files.length;
        console.log(`📤 Uploading ${fileCount} file(s) to ${API_BASE_URL}/convert`);
        
        // ALWAYS use /convert endpoint
        const response = await fetch(`${API_BASE_URL}/convert`, {
            method: 'POST',
            body: formData
        });

        // Get stats from response headers
        const stats = {
            totalSubmitted: response.headers.get('X-Total-Time-Ms') || 'N/A',
            conversionTime: response.headers.get('X-Conversion-Time-Ms') || 'N/A',
            filesConverted: response.headers.get('X-Files-Converted') || '0',
            filesFailed: response.headers.get('X-Files-Failed') || '0'
        };

        console.log('📊 Response Headers:', stats);

        if (!response.ok) {
            const errorData = await response.json().catch(() => null);
            throw new Error(errorData?.error || `Upload failed with status ${response.status}`);
        }

        const contentType = response.headers.get('Content-Type');
        const contentDisposition = response.headers.get('Content-Disposition');
        
        console.log(`📥 Response type: ${contentType}`);
        
        const blob = await response.blob();
        console.log(`📦 Downloaded blob: ${(blob.size / (1024*1024)).toFixed(1)} MB`);
        
        if (contentType === 'application/zip') {
            // ZIP archive (multiple files)
            let filename = 'converted_images.zip';
            if (contentDisposition) {
                const match = contentDisposition.match(/filename="(.+)"/);
                if (match) filename = match[1];
            }
            return { 
                type: 'zip', 
                blob, 
                filename,
                fileCount: fileCount
            };
        } else {
            // Single PNG file
            let filename = 'converted.png';
            if (contentDisposition) {
                const match = contentDisposition.match(/filename="(.+)"/);
                if (match) filename = match[1];
            }
            return { 
                type: 'single', 
                blob, 
                filename,
                fileCount: 1
            };
        }
    }

    static async getStats() {
        try {
            const response = await fetch(`${API_BASE_URL}/stats`);
            if (response.ok) {
                return await response.json();
            }
        } catch (error) {
            console.warn('⚠️ Failed to fetch stats:', error.message);
        }
        return null;
    }
}

// UI Components
class UIManager {
    constructor(state) {
        this.state = state;
        this.elements = this.cacheElements();
        this.initEventListeners();
        this.state.subscribe(this.render.bind(this));
        this.loadStats();
        this.statsInterval = setInterval(() => this.loadStats(), 30000);
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
            downloadAllSection: document.getElementById('downloadAllSection') || this.createDownloadAllSection()
        };
    }

    createDownloadAllSection() {
        const section = document.createElement('section');
        section.id = 'downloadAllSection';
        section.className = 'download-all-section hidden';
        const filesSection = document.querySelector('.files-section');
        if (filesSection) {
            filesSection.after(section);
        }
        return section;
    }

    initEventListeners() {
        // Upload zone click
        this.elements.uploadZone.addEventListener('click', () => {
            this.elements.fileInput.click();
        });

        // File input change
        this.elements.fileInput.addEventListener('change', (e) => {
            this.handleFileSelect(e.target.files);
            this.elements.fileInput.value = ''; // Reset
        });

        // Drag and drop
        this.elements.uploadZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            this.elements.uploadZone.classList.add('drag-over');
        });

        this.elements.uploadZone.addEventListener('dragleave', () => {
            this.elements.uploadZone.classList.remove('drag-over');
        });

        this.elements.uploadZone.addEventListener('drop', (e) => {
            e.preventDefault();
            this.elements.uploadZone.classList.remove('drag-over');
            this.handleFileSelect(e.dataTransfer.files);
        });

        // Buttons
        this.elements.clearAllBtn.addEventListener('click', () => {
            if (this.state.getAllFiles().length > 0) {
                if (confirm('Are you sure you want to clear all files?')) {
                    this.state.clearAll();
                }
            }
        });

        this.elements.convertBtn.addEventListener('click', () => {
            this.handleConvert();
        });

        this.elements.errorCloseBtn.addEventListener('click', () => {
            this.hideError();
        });

        // Prevent default drag behavior on document
        document.addEventListener('dragover', (e) => e.preventDefault());
        document.addEventListener('drop', (e) => e.preventDefault());
    }

    handleFileSelect(fileList) {
        const files = Array.from(fileList);
        
        // Filter for HEIC/HEIF files
        const heicFiles = files.filter(file => {
            const ext = file.name.split('.').pop()?.toLowerCase();
            return ext === 'heic' || ext === 'heif' || 
                   file.type === 'image/heic' || file.type === 'image/heif';
        });

        if (heicFiles.length === 0) {
            this.showError('Please select HEIC or HEIF files only.');
            return;
        }

        console.log(`📁 Selected ${heicFiles.length} file(s)`);

        // Check file sizes
        const oversized = heicFiles.filter(f => f.size > MAX_FILE_SIZE);
        if (oversized.length > 0) {
            const names = oversized.map(f => `${f.name} (${this.formatFileSize(f.size)})`).join(', ');
            this.showError(`Files exceeding 50MB limit: ${names}`);
        }

        // Add valid files
        const validFiles = heicFiles.filter(f => f.size <= MAX_FILE_SIZE);
        validFiles.forEach(file => this.state.addFile(file));
        
        if (validFiles.length > 0) {
            this.hideError();
            console.log(`✅ Added ${validFiles.length} file(s)`);
            
            // Scroll to files section
            setTimeout(() => {
                this.elements.filesSection.scrollIntoView({ behavior: 'smooth' });
            }, 100);
        }
    }

    async handleConvert() {
        const pendingFiles = this.state.getPendingFiles();
        if (pendingFiles.length === 0) {
            this.showError('No files to convert.');
            return;
        }

        const fileCount = pendingFiles.length;
        console.log(`🔄 Starting conversion of ${fileCount} file(s)...`);

        // Disable button and show loading state
        this.elements.convertBtn.disabled = true;
        this.elements.convertBtn.innerHTML = '<span class="spinner"></span> Converting...';

        // Mark all files as converting
        pendingFiles.forEach(file => {
            this.state.updateFile(file.id, { 
                status: 'converting', 
                progress: 50 
            });
        });

        // Show converting message
        this.showConversionMessage(fileCount);

        try {
            const startTime = performance.now();
            const result = await ApiClient.uploadFiles(pendingFiles);
            const elapsed = ((performance.now() - startTime) / 1000).toFixed(1);
            
            console.log(`✅ Conversion complete in ${elapsed}s`, result);

            if (result.type === 'single') {
                // Single file converted
                const fileId = pendingFiles[0].id;
                this.state.updateFile(fileId, {
                    status: 'success',
                    progress: 100,
                    convertedBlob: result.blob,
                    convertedName: result.filename,
                    convertedSize: result.blob.size
                });
                
                // Auto-download single file
                setTimeout(() => {
                    this.downloadBlob(result.blob, result.filename);
                }, 500);
                
            } else if (result.type === 'zip') {
                // Multiple files - store ZIP for batch download
                this.state.batchZipBlob = result.blob;
                
                // Update all pending files as success
                pendingFiles.forEach(file => {
                    this.state.updateFile(file.id, {
                        status: 'success',
                        progress: 100,
                        convertedBlob: result.blob,
                        convertedName: result.filename,
                        convertedSize: result.blob.size
                    });
                });

                // Auto-download ZIP for bulk conversions
                if (fileCount > BULK_DOWNLOAD_THRESHOLD) {
                    setTimeout(() => {
                        this.downloadBlob(result.blob, result.filename);
                    }, 800);
                }
            }

            this.hideError();
            this.loadStats(); // Refresh stats
            
        } catch (error) {
            console.error('❌ Conversion failed:', error);
            
            // Mark all as error
            pendingFiles.forEach(file => {
                this.state.updateFile(file.id, {
                    status: 'error',
                    progress: 100,
                    error: error.message || 'Conversion failed'
                });
            });
            
            this.showError(error.message || 'Conversion failed. Please try again.');
            
        } finally {
            // Re-enable button
            this.elements.convertBtn.disabled = false;
            this.elements.convertBtn.innerHTML = `
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                    <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
                Convert All
            `;
        }
    }

    showConversionMessage(fileCount) {
        // Simple conversion status message
        const msg = fileCount > 10 
            ? `Converting ${fileCount} files in parallel... This may take a few seconds.`
            : `Converting ${fileCount} file(s)...`;
        console.log(`⏳ ${msg}`);
    }

    downloadBlob(blob, filename) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        
        // Clean up after a short delay
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        
        console.log(`💾 Downloaded: ${filename} (${this.formatFileSize(blob.size)})`);
    }

    downloadAllAsZip() {
        if (this.state.batchZipBlob) {
            const count = this.state.getSuccessFiles().length;
            const filename = `heic_to_png_${count}_images.zip`;
            this.downloadBlob(this.state.batchZipBlob, filename);
        } else {
            this.showError('No batch download available. Please convert files first.');
        }
    }

    downloadSingleFile(fileId) {
        const fileData = this.state.getFile(fileId);
        if (fileData?.convertedBlob && fileData?.convertedName) {
            this.downloadBlob(fileData.convertedBlob, fileData.convertedName);
        }
    }

    showError(message) {
        console.error(`❌ ${message}`);
        this.elements.errorMessage.textContent = message;
        this.elements.errorSection.style.display = 'block';
        
        // Auto-hide after 8 seconds
        clearTimeout(this._errorTimeout);
        this._errorTimeout = setTimeout(() => this.hideError(), 8000);
    }

    hideError() {
        this.elements.errorSection.style.display = 'none';
        clearTimeout(this._errorTimeout);
    }

    async loadStats() {
        const stats = await ApiClient.getStats();
        if (stats) {
            this.elements.todayCount.textContent = stats.conversions_today || 0;
            
            if (stats.total_files_converted) {
                this.elements.todayCount.title = 
                    `Total: ${stats.total_conversions} conversions\n` +
                    `Files: ${stats.total_files_converted}\n` +
                    `Data: ${stats.total_mb_processed} MB`;
            }
        }
    }

    formatFileSize(bytes) {
        if (!bytes || bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    render(files) {
        const filesArray = files;
        
        // Show/hide files section
        if (filesArray.length > 0) {
            this.elements.filesSection.style.display = 'block';
            this.elements.fileCount.textContent = filesArray.length;
        } else {
            this.elements.filesSection.style.display = 'none';
        }

        // Render files
        this.elements.filesGrid.innerHTML = filesArray.map(f => this.renderFileItem(f)).join('');

        // Attach listeners
        filesArray.forEach(fileData => {
            const downloadBtn = document.getElementById(`download-${fileData.id}`);
            if (downloadBtn) {
                downloadBtn.onclick = (e) => {
                    e.stopPropagation();
                    this.downloadSingleFile(fileData.id);
                };
            }

            const removeBtn = document.getElementById(`remove-${fileData.id}`);
            if (removeBtn) {
                removeBtn.onclick = (e) => {
                    e.stopPropagation();
                    this.state.removeFile(fileData.id);
                };
            }
        });

        // Download All section
        const successCount = filesArray.filter(f => f.status === 'success').length;
        
        if (successCount > 0 && this.state.batchZipBlob) {
            // Show batch download button
            this.elements.downloadAllSection.innerHTML = `
                <div class="bulk-download-card">
                    <div class="bulk-download-info">
                        <span class="bulk-download-icon">📦</span>
                        <div>
                            <strong>Batch Download Ready</strong>
                            <p>${successCount} files converted successfully</p>
                            ${successCount > BULK_DOWNLOAD_THRESHOLD ? '<p class="text-sm text-gray-500">All files packaged in a single ZIP</p>' : ''}
                        </div>
                    </div>
                    <button class="btn btn-primary btn-large" id="downloadAllBtn">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                            <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                        </svg>
                        Download All as ZIP (${successCount} images)
                    </button>
                </div>
            `;
            this.elements.downloadAllSection.classList.remove('hidden');
            
            const downloadAllBtn = document.getElementById('downloadAllBtn');
            if (downloadAllBtn) {
                downloadAllBtn.onclick = () => this.downloadAllAsZip();
            }
        } else if (successCount > 0 && successCount <= BULK_DOWNLOAD_THRESHOLD) {
            // Show individual download info
            this.elements.downloadAllSection.innerHTML = `
                <div class="text-center text-gray-600 text-sm">
                    ✅ ${successCount} file(s) ready for download. Click individual Download buttons above.
                </div>
            `;
            this.elements.downloadAllSection.classList.remove('hidden');
        } else {
            this.elements.downloadAllSection.classList.add('hidden');
        }

        // Update convert button
        const hasPending = filesArray.some(f => f.status === 'pending');
        this.elements.convertBtn.disabled = !hasPending;
    }

    renderFileItem(fileData) {
        const statusClass = `status-${fileData.status}`;
        const progressClass = fileData.status === 'success' ? 'complete' : 
                             fileData.status === 'error' ? 'error' : '';
        
        const progressWidth = fileData.status === 'converting' ? '50%' :
                             fileData.status === 'success' || fileData.status === 'error' ? '100%' : '0%';

        let actionButton = '';
        if (fileData.status === 'success') {
            const totalSuccess = this.state.getSuccessFiles().length;
            
            if (totalSuccess <= BULK_DOWNLOAD_THRESHOLD) {
                // Individual download for small batches
                actionButton = `
                    <button class="btn btn-primary btn-small" id="download-${fileData.id}">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                            <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                        </svg>
                        Download
                    </button>
                `;
            } else {
                // Bulk download - show badge
                actionButton = '<span class="badge badge-success">In ZIP</span>';
            }
        } else if (fileData.status === 'error') {
            actionButton = `
                <button class="btn btn-secondary btn-small" id="remove-${fileData.id}">
                    ✕
                </button>
            `;
        } else if (fileData.status === 'converting') {
            actionButton = '<span class="spinner"></span>';
        }

        const statusLabels = {
            'pending': 'Ready',
            'converting': 'Converting...',
            'success': 'Completed',
            'error': fileData.error || 'Failed'
        };
        
        const fileIcons = {
            'pending': '📄',
            'converting': '⚙️',
            'success': '✅',
            'error': '❌'
        };

        return `
            <div class="file-item ${statusClass}">
                <div class="file-icon">${fileIcons[fileData.status]}</div>
                <div class="file-info">
                    <div class="file-name">${this.escapeHtml(fileData.file.name)}</div>
                    <div class="file-meta">
                        <span>Size: ${this.formatFileSize(fileData.originalSize)}</span>
                        ${fileData.convertedSize ? `<span>→ ${this.formatFileSize(fileData.convertedSize)}</span>` : ''}
                        <span class="file-status ${fileData.status}">${statusLabels[fileData.status]}</span>
                    </div>
                    ${fileData.status !== 'pending' ? `
                        <div class="file-progress">
                            <div class="file-progress-bar ${progressClass}" style="width: ${progressWidth}"></div>
                        </div>
                    ` : ''}
                </div>
                <div class="file-actions">
                    ${actionButton}
                </div>
            </div>
        `;
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}

// Initialize Application
document.addEventListener('DOMContentLoaded', () => {
    console.log('🚀 HEIC to PNG Converter initialized');
    
    const state = new AppState();
    const ui = new UIManager(state);
    
    // Handle paste events for HEIC files
    document.addEventListener('paste', (e) => {
        const items = e.clipboardData?.items;
        if (!items) return;
        
        const files = [];
        for (const item of items) {
            if (item.kind === 'file') {
                const file = item.getAsFile();
                const ext = file.name.split('.').pop()?.toLowerCase();
                if (ext === 'heic' || ext === 'heif') {
                    files.push(file);
                }
            }
        }
        
        if (files.length > 0) {
            e.preventDefault();
            ui.handleFileSelect(files);
        }
    });
    
    console.log('✅ Ready for conversion');
});