// ============================================================================
// COMPLETE VIDEO CONVERTER WITH DEBUGGING FOR CHROME ANDROID
// ============================================================================

// ============================================================================
// DEBUGGING SYSTEM
// ============================================================================

const DEBUG_VIDEO = true;

// Create debug panel if it doesn't exist
function ensureDebugPanel() {
    let debugPanel = document.getElementById('video-debug-panel');
    if (!debugPanel && document.body) {
        debugPanel = document.createElement('div');
        debugPanel.id = 'video-debug-panel';
        debugPanel.style.cssText = `
            position: fixed;
            bottom: 10px;
            right: 10px;
            width: 350px;
            max-width: 90vw;
            background: rgba(0,0,0,0.95);
            color: #0f0;
            font-family: 'Courier New', monospace;
            font-size: 10px;
            padding: 10px;
            border-radius: 8px;
            z-index: 10000;
            border: 1px solid #0f0;
            box-shadow: 0 4px 20px rgba(0,0,0,0.5);
            pointer-events: auto;
            max-height: 300px;
            overflow-y: auto;
            display: none;
        `;
        
        const header = document.createElement('div');
        header.style.cssText = 'display: flex; justify-content: space-between; margin-bottom: 8px; border-bottom: 1px solid #0f0; padding-bottom: 4px;';
        header.innerHTML = `
            <strong>🐛 VIDEO DEBUGGER</strong>
            <button id="closeDebugPanel" style="background: none; border: none; color: #0f0; cursor: pointer; font-size: 14px;">✕</button>
        `;
        debugPanel.appendChild(header);
        
        const content = document.createElement('div');
        content.id = 'video-debug-content';
        debugPanel.appendChild(content);
        
        const footer = document.createElement('div');
        footer.style.cssText = 'margin-top: 8px; font-size: 8px; color: #666; border-top: 1px solid #333; padding-top: 4px;';
        footer.innerHTML = 'Tap logo 5x to show/hide | 3G may take 2-3 min';
        debugPanel.appendChild(footer);
        
        document.body.appendChild(debugPanel);
        
        document.getElementById('closeDebugPanel')?.addEventListener('click', () => {
            debugPanel.style.display = 'none';
        });
    }
    return document.getElementById('video-debug-panel');
}

function videoDebugLog(message, type = 'info') {
    if (!DEBUG_VIDEO) return;
    
    const timestamp = new Date().toLocaleTimeString();
    const logEntry = `[${timestamp}] ${message}`;
    console.log(`🎥 ${logEntry}`);
    
    // Add to visible panel
    const panel = document.getElementById('video-debug-panel');
    const content = document.getElementById('video-debug-content');
    if (panel && content && panel.style.display !== 'none') {
        const div = document.createElement('div');
        div.style.cssText = 'border-bottom: 1px solid #333; padding: 3px 0; word-wrap: break-word;';
        if (type === 'error') div.style.color = '#ff6b6b';
        else if (type === 'success') div.style.color = '#51cf66';
        else if (type === 'warning') div.style.color = '#ffd43b';
        div.textContent = logEntry;
        content.appendChild(div);
        content.scrollTop = content.scrollHeight;
        
        // Keep only last 30 messages
        while (content.children.length > 30) {
            content.removeChild(content.firstChild);
        }
    }
}

// Toggle debug panel with 5 taps on logo
let debugTapCount = 0;
let debugTapTimer = null;

function initDebugPanelTrigger() {
    const checkLogo = setInterval(() => {
        const logo = document.querySelector('.logo');
        if (logo) {
            clearInterval(checkLogo);
            logo.addEventListener('click', () => {
                debugTapCount++;
                clearTimeout(debugTapTimer);
                debugTapTimer = setTimeout(() => { debugTapCount = 0; }, 1000);
                
                if (debugTapCount === 5) {
                    const panel = document.getElementById('video-debug-panel');
                    if (panel) {
                        panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
                        if (panel.style.display === 'block') {
                            videoDebugLog('Debug panel opened', 'success');
                        }
                    } else {
                        const newPanel = ensureDebugPanel();
                        newPanel.style.display = 'block';
                    }
                    debugTapCount = 0;
                }
            });
        }
    }, 100);
}

// ============================================================================
// FFMPEG LOADER WITH MULTIPLE FALLBACKS
// ============================================================================

let ffmpeg = null;
let isFFmpegLoaded = false;

async function loadFFmpeg() {
    videoDebugLog('=== Starting FFmpeg loader ===');
    videoDebugLog(`User Agent: ${navigator.userAgent.substring(0, 80)}`);
    videoDebugLog(`URL: ${window.location.href}`);
    
    if (isFFmpegLoaded && ffmpeg) {
        videoDebugLog('FFmpeg already loaded', 'success');
        return ffmpeg;
    }
    
    // Check SharedArrayBuffer
    videoDebugLog('Checking SharedArrayBuffer...');
    if (typeof SharedArrayBuffer === 'undefined') {
        const errorMsg = 'SharedArrayBuffer NOT available. Video conversion requires COOP/COEP headers.';
        videoDebugLog(errorMsg, 'error');
        videoDebugLog('Fix: Use Node.js server with headers (see server.js)', 'warning');
        throw new Error(errorMsg + ' Use the Node.js server with proper headers.');
    }
    videoDebugLog('✅ SharedArrayBuffer available', 'success');
    
    // Check network
    if (navigator.connection) {
        videoDebugLog(`Network: ${navigator.connection.effectiveType}, ${navigator.connection.downlink} Mbps`);
        if (navigator.connection.effectiveType === '3g') {
            videoDebugLog('⚠️ 3G detected - download may take 2-3 minutes', 'warning');
        }
    }
    
    // Try multiple configurations
    const configs = [
        {
            corePath: 'https://unpkg.com/@ffmpeg/core@0.10.0/dist/ffmpeg-core.js',
            useWorker: false,
            name: 'unpkg v0.10.0'
        },
        {
            corePath: 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.10.0/dist/ffmpeg-core.js',
            useWorker: false,
            name: 'jsdelivr v0.10.0'
        },
        {
            corePath: 'https://unpkg.com/@ffmpeg/core@0.9.0/dist/ffmpeg-core.js',
            useWorker: false,
            name: 'unpkg v0.9.0'
        },
        {
            corePath: 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.9.0/dist/ffmpeg-core.js',
            useWorker: true,
            name: 'jsdelivr v0.9.0 (worker)'
        }
    ];
    
    let lastError = null;
    
    for (const config of configs) {
        try {
            videoDebugLog(`\n📥 Trying: ${config.name}`);
            videoDebugLog(`Core path: ${config.corePath.substring(0, 60)}...`);
            
            // Get createFFmpeg function
            let createFFmpeg = window.createFFmpeg;
            if (!createFFmpeg && window.FFmpeg) {
                createFFmpeg = window.FFmpeg.createFFmpeg;
            }
            if (!createFFmpeg && window.FFmpeg?.default?.createFFmpeg) {
                createFFmpeg = window.FFmpeg.default.createFFmpeg;
            }
            
            if (!createFFmpeg) {
                throw new Error('createFFmpeg not found');
            }
            
            ffmpeg = createFFmpeg({
                log: true,
                corePath: config.corePath,
                useWorker: config.useWorker
            });
            
            // Progress callback for download
            ffmpeg.setProgress(({ ratio }) => {
                const percent = Math.round(ratio * 100);
                if (percent % 20 === 0 && percent < 100) {
                    videoDebugLog(`Download progress: ${percent}%`);
                }
                updateFFmpegLoadProgress(percent);
            });
            
            // Logger
            ffmpeg.setLogger(({ type, message }) => {
                if (type === 'info' && (message.includes('fetch') || message.includes('download'))) {
                    videoDebugLog(`FFmpeg: ${message.substring(0, 80)}`);
                } else if (type === 'error') {
                    videoDebugLog(`FFmpeg error: ${message}`, 'error');
                }
            });
            
            videoDebugLog(`Loading FFmpeg core (may take 30-60s on 3G)...`);
            const loadStart = Date.now();
            
            // Load with timeout
            const loadPromise = ffmpeg.load();
            const timeoutPromise = new Promise((_, reject) => 
                setTimeout(() => reject(new Error('Timeout after 60 seconds')), 60000)
            );
            
            await Promise.race([loadPromise, timeoutPromise]);
            const loadTime = (Date.now() - loadStart) / 1000;
            
            videoDebugLog(`✅ FFmpeg loaded in ${loadTime}s from ${config.name}`, 'success');
            isFFmpegLoaded = true;
            return ffmpeg;
            
        } catch (error) {
            videoDebugLog(`❌ Failed: ${config.name} - ${error.message}`, 'error');
            lastError = error;
            ffmpeg = null;
        }
    }
    
    videoDebugLog('=== ALL FFMPEG LOAD ATTEMPTS FAILED ===', 'error');
    throw new Error('Video converter unavailable. Please check your internet connection and ensure COOP/COEP headers are set.');
}

function updateFFmpegLoadProgress(percent) {
    const progressBar = document.getElementById('videoProgressBar');
    const progressPercent = document.getElementById('videoProgressPercent');
    const progressText = document.getElementById('videoProgressText');
    
    if (progressBar) progressBar.style.width = `${percent}%`;
    if (progressPercent) progressPercent.textContent = `${percent}%`;
    if (progressText && percent < 100) {
        progressText.textContent = `Downloading converter... ${percent}% (may take 2-3 min on 3G)`;
    }
}

// ============================================================================
// VIDEO TO MP3 CONVERTER CLASS
// ============================================================================

class VideoToMp3Converter {
    constructor() {
        this.ffmpeg = null;
        this.videoFile = null;
        this.videoDuration = 0;
        this.mp3Blob = null;
        this.isLoaded = false;
        this.isConverting = false;
    }
    
    async loadFFmpeg() {
        if (this.isLoaded && this.ffmpeg) return true;
        try {
            this.ffmpeg = await loadFFmpeg();
            this.isLoaded = true;
            videoDebugLog('Converter ready for use', 'success');
            return true;
        } catch (error) {
            videoDebugLog(`Load failed: ${error.message}`, 'error');
            throw error;
        }
    }
    
    async loadVideo(file) {
        if (!file) throw new Error('No video file');
        this.videoFile = file;
        
        return new Promise((resolve, reject) => {
            const video = document.createElement('video');
            video.preload = 'metadata';
            const url = URL.createObjectURL(file);
            
            video.onloadedmetadata = () => {
                URL.revokeObjectURL(url);
                this.videoDuration = video.duration;
                videoDebugLog(`Video loaded: ${this.videoDuration.toFixed(1)}s, ${(file.size / 1024 / 1024).toFixed(1)}MB`, 'success');
                resolve(this.videoDuration);
            };
            
            video.onerror = () => {
                URL.revokeObjectURL(url);
                reject(new Error('Cannot read video file'));
            };
            
            video.src = url;
        });
    }
    
    getTrimTimes() {
        const startSlider = document.getElementById('trimStart');
        const endSlider = document.getElementById('trimEnd');
        
        let startPercent = startSlider ? parseFloat(startSlider.value) : 0;
        let endPercent = endSlider ? parseFloat(endSlider.value) : 100;
        
        if (isNaN(startPercent)) startPercent = 0;
        if (isNaN(endPercent)) endPercent = 100;
        if (startPercent >= endPercent) endPercent = Math.min(startPercent + 5, 100);
        
        let startTime = (startPercent / 100) * this.videoDuration;
        let endTime = (endPercent / 100) * this.videoDuration;
        if (endTime - startTime < 1) endTime = Math.min(startTime + 1, this.videoDuration);
        
        return { startTime, endTime };
    }
    
    async convertToMp3(startTime, endTime) {
        if (!this.isLoaded) await this.loadFFmpeg();
        if (!this.videoFile) throw new Error('No video loaded');
        if (this.isConverting) throw new Error('Conversion in progress');
        
        this.isConverting = true;
        const ff = this.ffmpeg;
        const extension = this.videoFile.name.split('.').pop()?.toLowerCase() || 'mp4';
        const inputFilename = `input.${extension}`;
        const outputFilename = 'output.mp3';
        
        try {
            videoDebugLog(`Starting conversion: ${startTime.toFixed(1)}s to ${endTime.toFixed(1)}s`);
            
            // Write video file to FFmpeg virtual filesystem
            const videoData = await this.videoFile.arrayBuffer();
            ff.FS('writeFile', inputFilename, new Uint8Array(videoData));
            videoDebugLog(`Video written to memory: ${(videoData.byteLength / 1024 / 1024).toFixed(1)}MB`);
            
            // Build command
            const command = [];
            if (startTime > 0.1) command.push('-ss', startTime.toFixed(3));
            command.push('-i', inputFilename);
            
            const duration = endTime - startTime;
            if (duration < this.videoDuration - 0.1) command.push('-t', duration.toFixed(3));
            
            command.push(
                '-vn', '-acodec', 'libmp3lame',
                '-ab', '192k', '-ar', '44100', '-ac', '2',
                outputFilename
            );
            
            videoDebugLog(`FFmpeg command: ${command.join(' ')}`);
            
            // Run conversion
            await ff.run(...command);
            
            // Read result
            const outputData = ff.FS('readFile', outputFilename);
            this.mp3Blob = new Blob([outputData.buffer], { type: 'audio/mpeg' });
            
            // Cleanup
            ff.FS('unlink', inputFilename);
            ff.FS('unlink', outputFilename);
            
            videoDebugLog(`✅ Conversion complete: ${(this.mp3Blob.size / 1024).toFixed(0)}KB`, 'success');
            return this.mp3Blob;
            
        } catch (error) {
            videoDebugLog(`Conversion error: ${error.message}`, 'error');
            try { ff.FS('unlink', inputFilename); } catch(e) {}
            try { ff.FS('unlink', outputFilename); } catch(e) {}
            throw error;
        } finally {
            this.isConverting = false;
        }
    }
    
    getMp3Blob() { return this.mp3Blob; }
    
    reset() {
        this.videoFile = null;
        this.videoDuration = 0;
        this.mp3Blob = null;
        this.isConverting = false;
    }
}

// Create global instance
const videoConverter = new VideoToMp3Converter();

// ============================================================================
// INITIALIZATION
// ============================================================================

function initVideoConverter() {
    videoDebugLog('Initializing video converter UI...');
    
    const elements = {
        uploadZone: document.getElementById('videoUploadZone'),
        fileInput: document.getElementById('videoFileInput'),
        section: document.getElementById('videoSection'),
        preview: document.getElementById('videoPreview'),
        trimStart: document.getElementById('trimStart'),
        trimEnd: document.getElementById('trimEnd'),
        trimStartLabel: document.getElementById('trimStartLabel'),
        trimEndLabel: document.getElementById('trimEndLabel'),
        trimDuration: document.getElementById('trimDuration'),
        resetBtn: document.getElementById('resetTrimBtn'),
        convertBtn: document.getElementById('videoConvertBtn'),
        clearBtn: document.getElementById('videoClearBtn'),
        progress: document.getElementById('videoProgress'),
        downloadReady: document.getElementById('videoDownloadReady'),
        downloadBtn: document.getElementById('videoDownloadBtn')
    };
    
    if (!elements.uploadZone || !elements.fileInput) {
        videoDebugLog('Required elements not found, skipping init', 'warning');
        return;
    }
    
    let currentVideoFile = null;
    let currentDuration = 0;
    const originalBtnHTML = elements.convertBtn?.innerHTML || 'Convert to MP3';
    
    function updateTrimLabels() {
        if (!elements.trimStart || !elements.trimEnd) return;
        const startPercent = parseFloat(elements.trimStart.value) || 0;
        const endPercent = parseFloat(elements.trimEnd.value) || 100;
        const startTime = (startPercent / 100) * currentDuration;
        const endTime = (endPercent / 100) * currentDuration;
        
        if (elements.trimStartLabel) elements.trimStartLabel.textContent = startTime.toFixed(1) + 's';
        if (elements.trimEndLabel) elements.trimEndLabel.textContent = endTime.toFixed(1) + 's';
        if (elements.trimDuration) elements.trimDuration.textContent = (endTime - startTime).toFixed(1) + 's';
        
        if (elements.preview?.readyState >= 1) {
            elements.preview.currentTime = startTime;
        }
    }
    
    async function loadVideoFile(file) {
        const ext = file.name.split('.').pop()?.toLowerCase();
        const validExts = ['mp4', 'mov', 'avi', 'webm', 'mkv', 'm4v', 'mpg', 'mpeg'];
        
        if (!validExts.includes(ext)) {
            window.App?.showError('Please select a valid video file (MP4, MOV, AVI, WebM, MKV).');
            return;
        }
        
        if (file.size > 200 * 1024 * 1024) {
            window.App?.showError('Video must be under 200MB.');
            return;
        }
        
        currentVideoFile = file;
        const url = URL.createObjectURL(file);
        if (elements.preview) elements.preview.src = url;
        if (elements.section) elements.section.style.display = 'block';
        if (elements.progress) elements.progress.style.display = 'none';
        if (elements.downloadReady) elements.downloadReady.style.display = 'none';
        
        if (elements.preview) {
            elements.preview.onloadedmetadata = () => {
                currentDuration = elements.preview.duration;
                if (elements.trimStart) elements.trimStart.max = 100;
                if (elements.trimEnd) elements.trimEnd.max = 100;
                if (elements.trimEnd) elements.trimEnd.value = 100;
                if (elements.trimStart) elements.trimStart.value = 0;
                updateTrimLabels();
                videoDebugLog(`Video ready: ${currentDuration.toFixed(1)}s duration`, 'success');
            };
        }
        
        window.App?.hideError();
        videoConverter.reset();
    }
    
    // Event listeners
    elements.uploadZone.addEventListener('click', () => elements.fileInput.click());
    
    elements.fileInput.addEventListener('change', (e) => {
        if (e.target.files?.[0]) loadVideoFile(e.target.files[0]);
        e.target.value = '';
    });
    
    // Drag and drop
    ['dragover', 'dragleave', 'drop'].forEach(evt => {
        elements.uploadZone.addEventListener(evt, (e) => {
            e.preventDefault();
            if (evt === 'dragover') elements.uploadZone.classList.add('drag-over');
            else if (evt === 'dragleave') elements.uploadZone.classList.remove('drag-over');
            else if (evt === 'drop') {
                elements.uploadZone.classList.remove('drag-over');
                if (e.dataTransfer.files[0]) loadVideoFile(e.dataTransfer.files[0]);
            }
        });
    });
    
    if (elements.trimStart) elements.trimStart.addEventListener('input', updateTrimLabels);
    if (elements.trimEnd) elements.trimEnd.addEventListener('input', updateTrimLabels);
    
    if (elements.resetBtn) {
        elements.resetBtn.addEventListener('click', () => {
            if (elements.trimStart) elements.trimStart.value = 0;
            if (elements.trimEnd) elements.trimEnd.value = 100;
            updateTrimLabels();
            if (elements.preview?.readyState >= 1) elements.preview.currentTime = 0;
        });
    }
    
    if (elements.convertBtn) {
        elements.convertBtn.addEventListener('click', async () => {
            if (!currentVideoFile) {
                window.App?.showError('Please select a video file first.');
                return;
            }
            
            if (videoConverter.isConverting) {
                window.App?.showError('Conversion already in progress.');
                return;
            }
            
            elements.convertBtn.disabled = true;
            elements.convertBtn.innerHTML = '<span class="spinner"></span> Starting...';
            if (elements.progress) elements.progress.style.display = 'block';
            if (elements.downloadReady) elements.downloadReady.style.display = 'none';
            
            try {
                // Load FFmpeg (this downloads the core)
                elements.convertBtn.innerHTML = '<span class="spinner"></span> Loading converter (20MB)...';
                videoDebugLog('Loading FFmpeg (may take 30-60s on 3G)...');
                await videoConverter.loadFFmpeg();
                
                // Load video
                elements.convertBtn.innerHTML = '<span class="spinner"></span> Loading video...';
                await videoConverter.loadVideo(currentVideoFile);
                
                // Convert
                const { startTime, endTime } = videoConverter.getTrimTimes();
                elements.convertBtn.innerHTML = '<span class="spinner"></span> Converting...';
                await videoConverter.convertToMp3(startTime, endTime);
                
                // Success!
                if (elements.progress) elements.progress.style.display = 'none';
                if (elements.downloadReady) elements.downloadReady.style.display = 'block';
                
                // Auto-download
                const mp3Name = currentVideoFile.name.replace(/\.[^.]+$/, '') + '.mp3';
                const blob = videoConverter.getMp3Blob();
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = mp3Name;
                a.click();
                setTimeout(() => URL.revokeObjectURL(url), 1000);
                
                videoDebugLog('Conversion completed, download started', 'success');
                
                // Update stats
                if (window.StatsStore) {
                    window.StatsStore.increment(1);
                    const todayCount = document.getElementById('todayCount');
                    if (todayCount) todayCount.textContent = window.StatsStore.getToday();
                }
                
                setTimeout(() => window.App?.showFeedbackModal(), 1500);
                
            } catch (error) {
                videoDebugLog(`Conversion failed: ${error.message}`, 'error');
                window.App?.showError(error.message || 'Conversion failed. Try a smaller MP4 file.');
                if (elements.progress) elements.progress.style.display = 'none';
            } finally {
                elements.convertBtn.disabled = false;
                elements.convertBtn.innerHTML = originalBtnHTML;
            }
        });
    }
    
    if (elements.downloadBtn) {
        elements.downloadBtn.addEventListener('click', () => {
            const blob = videoConverter.getMp3Blob();
            if (blob && currentVideoFile) {
                const name = currentVideoFile.name.replace(/\.[^.]+$/, '') + '.mp3';
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = name;
                a.click();
                setTimeout(() => URL.revokeObjectURL(url), 1000);
            }
        });
    }
    
    if (elements.clearBtn) {
        elements.clearBtn.addEventListener('click', () => {
            currentVideoFile = null;
            if (elements.preview) elements.preview.src = '';
            if (elements.section) elements.section.style.display = 'none';
            if (elements.progress) elements.progress.style.display = 'none';
            if (elements.downloadReady) elements.downloadReady.style.display = 'none';
            videoConverter.reset();
        });
    }
    
    videoDebugLog('Video converter UI ready', 'success');
}

// Initialize on load
if (typeof window !== 'undefined') {
    ensureDebugPanel();
    initDebugPanelTrigger();
    
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            setTimeout(initVideoConverter, 500);
        });
    } else {
        setTimeout(initVideoConverter, 500);
    }
}

// Export for global use
window.videoConverter = videoConverter;
window.initVideoConverter = initVideoConverter;