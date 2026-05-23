// ============================================================================
// DEBUGGING: Chrome Mobile Diagnostics
// ============================================================================

const DEBUG = true;

function logDebug(message, data = null) {
    if (DEBUG) {
        const timestamp = new Date().toISOString().split('T')[1].slice(0, 12);
        console.log(`[${timestamp}] 🔍 ${message}`, data || '');
        
        // Also log to a visible div on mobile
        let debugPanel = document.getElementById('debug-panel');
        if (!debugPanel && document.body) {
            debugPanel = document.createElement('div');
            debugPanel.id = 'debug-panel';
            debugPanel.style.cssText = `
                position: fixed;
                bottom: 0;
                left: 0;
                right: 0;
                background: rgba(0,0,0,0.9);
                color: #0f0;
                font-family: monospace;
                font-size: 11px;
                padding: 8px;
                max-height: 150px;
                overflow-y: auto;
                z-index: 9999;
                display: none;
                pointer-events: none;
            `;
            document.body.appendChild(debugPanel);
        }
        
        if (debugPanel && window.location.search.includes('debug=true')) {
            debugPanel.style.display = 'block';
            const logLine = document.createElement('div');
            logLine.textContent = `${timestamp} ${message}`;
            logLine.style.borderBottom = '1px solid #333';
            debugPanel.appendChild(logLine);
            debugPanel.scrollTop = debugPanel.scrollHeight;
            
            // Keep only last 20 lines
            while (debugPanel.children.length > 20) {
                debugPanel.removeChild(debugPanel.firstChild);
            }
        }
    }
}

// Run diagnostic tests
async function runMobileDiagnostics() {
    logDebug('=== MOBILE DIAGNOSTICS START ===');
    
    // 1. Browser detection
    const ua = navigator.userAgent;
    const isChrome = /Chrome/.test(ua) && !/Edg/.test(ua);
    const isAndroid = /Android/.test(ua);
    const chromeVersion = ua.match(/Chrome\/(\d+)/)?.[1] || 'unknown';
    
    logDebug(`Browser: ${isChrome ? 'Chrome' : 'Other'}, Android: ${isAndroid}, Chrome v${chromeVersion}`);
    
    // 2. Check SharedArrayBuffer
    let hasSAB = false;
    try {
        hasSAB = typeof SharedArrayBuffer !== 'undefined';
        logDebug(`SharedArrayBuffer: ${hasSAB ? '✅ AVAILABLE' : '❌ NOT AVAILABLE'}`);
        
        if (!hasSAB) {
            logDebug('⚠️ SharedArrayBuffer missing - FFmpeg.wasm WILL NOT WORK');
            logDebug('Need COOP/COEP headers or HTTPS/localhost');
            
            // Check if we're on HTTPS/localhost
            const isSecure = window.location.protocol === 'https:' || 
                            window.location.hostname === 'localhost' ||
                            window.location.hostname === '127.0.0.1';
            logDebug(`Secure context (HTTPS/localhost): ${isSecure ? '✅' : '❌'}`);
            
            // Check headers via fetch (if possible)
            try {
                const response = await fetch(window.location.href, { method: 'HEAD' });
                const coop = response.headers.get('Cross-Origin-Opener-Policy');
                const coep = response.headers.get('Cross-Origin-Embedder-Policy');
                logDebug(`COOP header: ${coop || 'missing'}`);
                logDebug(`COEP header: ${coep || 'missing'}`);
            } catch(e) {
                logDebug(`Could not check headers: ${e.message}`);
            }
        }
    } catch(e) {
        logDebug(`SharedArrayBuffer check error: ${e.message}`);
    }
    
    // 3. Check memory
    if ('deviceMemory' in navigator) {
        logDebug(`Device memory: ${navigator.deviceMemory} GB`);
    }
    if ('connection' in navigator) {
        logDebug(`Connection type: ${navigator.connection?.effectiveType || 'unknown'}`);
    }
    
    // 4. Test FFmpeg load with timeout
    logDebug('Attempting to test load FFmpeg...');
    const startTime = Date.now();
    
    try {
        // Try loading with timeout
        const loadPromise = loadFFmpeg();
        const timeoutPromise = new Promise((_, reject) => 
            setTimeout(() => reject(new Error('FFmpeg load timeout (15s)')), 15000)
        );
        
        await Promise.race([loadPromise, timeoutPromise]);
        const loadTime = Date.now() - startTime;
        logDebug(`✅ FFmpeg loaded successfully in ${loadTime}ms`);
    } catch (error) {
        logDebug(`❌ FFmpeg load failed: ${error.message}`);
        logDebug(`Error stack: ${error.stack?.substring(0, 200) || 'no stack'}`);
        
        // Check specific error patterns
        if (error.message.includes('SharedArrayBuffer')) {
            logDebug('🔧 FIX: Enable cross-origin isolation or use localhost with HTTPS');
        } else if (error.message.includes('memory')) {
            logDebug('🔧 FIX: Video too large for device memory');
        } else if (error.message.includes('fetch')) {
            logDebug('🔧 FIX: Network issue - check CORS or CDN availability');
        } else if (error.message.includes('timeout')) {
            logDebug('🔧 FIX: Slow connection or CDN blocking - try different network');
        }
    }
    
    // 5. Test CDN reachability
    const cdns = [
        'https://unpkg.com/@ffmpeg/ffmpeg@0.9.8/dist/ffmpeg.min.js',
        'https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.9.8/dist/ffmpeg.min.js'
    ];
    
    for (const cdn of cdns) {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 5000);
            const response = await fetch(cdn, { method: 'HEAD', signal: controller.signal });
            clearTimeout(timeoutId);
            logDebug(`CDN ${cdn.split('/')[2]}: ${response.ok ? '✅ reachable' : `❌ ${response.status}`}`);
        } catch(e) {
            logDebug(`CDN ${cdn.split('/')[2]}: ❌ unreachable (${e.message})`);
        }
    }
    
    // 6. Check for service workers that might block
    if ('serviceWorker' in navigator) {
        const registrations = await navigator.serviceWorker.getRegistrations();
        logDebug(`Service workers: ${registrations.length}`);
    }
    
    logDebug('=== MOBILE DIAGNOSTICS END ===');
    
    // Show user-friendly error if FFmpeg won't work
    if (!hasSAB) {
        const errorDiv = document.getElementById('errorSection');
        if (errorDiv) {
            const errorMsg = document.getElementById('errorMessage');
            if (errorMsg && window.App) {
                window.App.showError(
                    '⚠️ Chrome on Android requires HTTPS or localhost for video conversion. ' +
                    'Please access this site via HTTPS or use a different browser like Firefox. ' +
                    'HEIC to PNG conversion still works fine!'
                );
            }
        }
    }
}

// Run diagnostics on page load
if (typeof window !== 'undefined') {
    // Wait for DOM to load
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            setTimeout(runMobileDiagnostics, 1000);
        });
    } else {
        setTimeout(runMobileDiagnostics, 1000);
    }
}

// Add manual debug trigger (tap 5 times on logo to see debug panel)
let debugTapCount = 0;
let debugTapTimer = null;
document.addEventListener('DOMContentLoaded', () => {
    const logo = document.querySelector('.logo');
    if (logo) {
        logo.addEventListener('click', () => {
            debugTapCount++;
            clearTimeout(debugTapTimer);
            debugTapTimer = setTimeout(() => { debugTapCount = 0; }, 1000);
            
            if (debugTapCount === 5) {
                const panel = document.getElementById('debug-panel');
                if (panel) {
                    panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
                    debugTapCount = 0;
                    runMobileDiagnostics(); // Re-run diagnostics
                }
            }
        });
    }
});

// ============================================================================
// Video to MP3 Converter - FFmpeg.wasm
// ============================================================================

let ffmpeg = null;
let isFFmpegLoaded = false;

// Helper function to load FFmpeg with retry logic and debugging
async function loadFFmpeg() {
  // ========== DEBUGGING SECTION ==========
  const debugLog = [];
  const logDebug = (message, data = null) => {
    const timestamp = new Date().toISOString().split('T')[1].slice(0, 12);
    const logEntry = `[${timestamp}] ${message}`;
    debugLog.push(logEntry);
    console.log(logEntry, data || '');
    
    // Also log to visible debug panel if it exists
    if (typeof window !== 'undefined' && window.DEBUG_PANEL) {
      const panel = document.getElementById('debug-panel');
      if (panel) {
        const div = document.createElement('div');
        div.textContent = logEntry;
        div.style.fontSize = '10px';
        div.style.borderBottom = '1px solid #333';
        panel.appendChild(div);
        panel.scrollTop = panel.scrollHeight;
        while (panel.children.length > 20) panel.removeChild(panel.firstChild);
      }
    }
  };
  
  logDebug('=== loadFFmpeg() START ===');
  logDebug(`User Agent: ${navigator.userAgent}`);
  logDebug(`Location: ${window.location.href}`);
  logDebug(`Protocol: ${window.location.protocol}`);
  logDebug(`Hostname: ${window.location.hostname}`);
  
  // Check if already loaded
  if (isFFmpegLoaded && ffmpeg) {
    logDebug('FFmpeg already loaded, returning cached instance');
    return ffmpeg;
  }
  
  // ========== SHAREDARRAYBUFFER CHECK ==========
  logDebug('Checking SharedArrayBuffer support...');
  if (typeof SharedArrayBuffer === 'undefined') {
    const errorMsg = 'SharedArrayBuffer not available. Required for FFmpeg.wasm. ' +
                    'On Chrome Android, this requires HTTPS or localhost with proper COOP/COEP headers.';
    logDebug(`❌ ${errorMsg}`);
    
    // Provide detailed diagnosis
    const isSecure = window.location.protocol === 'https:' || 
                    window.location.hostname === 'localhost' ||
                    window.location.hostname === '127.0.0.1';
    logDebug(`Secure context (HTTPS/localhost): ${isSecure ? 'YES' : 'NO'}`);
    
    if (!isSecure) {
      throw new Error(`${errorMsg} Solution: Access via HTTPS or localhost`);
    } else {
      throw new Error(`${errorMsg} Solution: Add COOP/COEP headers to your server`);
    }
  }
  logDebug('✅ SharedArrayBuffer is available');
  
  // ========== CHECK MEMORY CONSTRAINTS ==========
  if (navigator.deviceMemory) {
    logDebug(`Device memory: ${navigator.deviceMemory} GB`);
    if (navigator.deviceMemory < 2) {
      logDebug('⚠️ Low memory device - FFmpeg may fail for large videos');
    }
  }
  
  // ========== CHECK NETWORK SPEED ==========
  if (navigator.connection) {
    logDebug(`Network: ${navigator.connection.effectiveType}, Downlink: ${navigator.connection.downlink} Mbps`);
    if (navigator.connection.saveData) {
      logDebug('⚠️ Data saver enabled - may affect CDN loading');
    }
  }
  
  // ========== TRY MULTIPLE CDN SOURCES ==========
  const configs = [
    // Primary: FFmpeg 0.10.0 from unpkg
    {
      corePath: 'https://unpkg.com/@ffmpeg/core@0.10.0/dist/ffmpeg-core.js',
      useWorker: false,
      version: '0.10.0 (unpkg)',
      priority: 1
    },
    // Secondary: FFmpeg 0.10.0 from jsdelivr
    {
      corePath: 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.10.0/dist/ffmpeg-core.js',
      useWorker: false,
      version: '0.10.0 (jsdelivr)',
      priority: 2
    },
    // Fallback: FFmpeg 0.9.0 from unpkg
    {
      corePath: 'https://unpkg.com/@ffmpeg/core@0.9.0/dist/ffmpeg-core.js',
      useWorker: false,
      version: '0.9.0 (unpkg)',
      priority: 3
    },
    // Fallback: FFmpeg 0.9.0 from jsdelivr
    {
      corePath: 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.9.0/dist/ffmpeg-core.js',
      useWorker: false,
      version: '0.9.0 (jsdelivr)',
      priority: 4
    },
    // Last resort: Use worker mode (may work where standard fails)
    {
      corePath: 'https://unpkg.com/@ffmpeg/core@0.10.0/dist/ffmpeg-core.js',
      useWorker: true,
      version: '0.10.0 (worker mode)',
      priority: 5
    },
    // Ultra fallback: Use older FFmpeg with worker
    {
      corePath: 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.9.0/dist/ffmpeg-core.js',
      useWorker: true,
      version: '0.9.0 (worker mode)',
      priority: 6
    }
  ];
  
  let lastError = null;
  let successConfig = null;
  
  for (const config of configs) {
    try {
      logDebug(`\n--- Attempt ${config.priority}/${configs.length}: ${config.version} ---`);
      logDebug(`Core path: ${config.corePath}`);
      logDebug(`Worker mode: ${config.useWorker}`);
      
      // Pre-check CDN availability with fetch
      logDebug(`Testing CDN connectivity...`);
      const cdnCheckStart = Date.now();
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);
        const response = await fetch(config.corePath, { method: 'HEAD', signal: controller.signal });
        clearTimeout(timeoutId);
        const cdnCheckTime = Date.now() - cdnCheckStart;
        if (response.ok) {
          logDebug(`✅ CDN reachable (${cdnCheckTime}ms)`);
        } else {
          logDebug(`⚠️ CDN returned status ${response.status}, attempting anyway...`);
        }
      } catch (fetchError) {
        logDebug(`⚠️ CDN check failed: ${fetchError.message}, attempting anyway...`);
      }
      
      // Get createFFmpeg function
      logDebug(`Looking for createFFmpeg on window...`);
      let createFFmpeg = window.createFFmpeg;
      if (!createFFmpeg && window.FFmpeg) {
        logDebug(`Found window.FFmpeg, checking for createFFmpeg...`);
        createFFmpeg = window.FFmpeg.createFFmpeg;
      }
      if (!createFFmpeg && window.FFmpeg && typeof window.FFmpeg === 'object') {
        logDebug(`Checking FFmpeg.default...`);
        createFFmpeg = window.FFmpeg.default?.createFFmpeg || window.FFmpeg.createFFmpeg;
      }
      
      if (!createFFmpeg) {
        throw new Error('createFFmpeg not found on window. Make sure FFmpeg script is loaded.');
      }
      logDebug(`✅ createFFmpeg function found`);
      
      // Create FFmpeg instance
      logDebug(`Creating FFmpeg instance with config...`);
      ffmpeg = createFFmpeg({
        log: true,
        corePath: config.corePath,
        useWorker: config.useWorker,
        // Add memory limit for mobile devices
        mainScriptUrl: config.corePath.replace('ffmpeg-core.js', 'ffmpeg-core.worker.js')
      });
      
      // Set up logging
      ffmpeg.setLogger(({ type, message }) => {
        if (type === 'error') {
          console.error('FFmpeg error:', message);
          logDebug(`FFmpeg error: ${message.substring(0, 100)}`);
        } else if (type === 'info') {
          console.log('FFmpeg info:', message);
          if (message.includes('loading') || message.includes('download')) {
            logDebug(`FFmpeg: ${message.substring(0, 100)}`);
          }
        }
      });
      
      // Set progress callback
      ffmpeg.setProgress(({ ratio, time }) => {
        const percent = Math.round(ratio * 100);
        const progressBar = document.getElementById('videoProgressBar');
        const progressPercent = document.getElementById('videoProgressPercent');
        const progressText = document.getElementById('videoProgressText');
        
        if (progressBar) progressBar.style.width = `${percent}%`;
        if (progressPercent) progressPercent.textContent = `${percent}%`;
        if (progressText) {
          if (percent < 100) {
            progressText.textContent = `Loading converter... ${percent}%`;
          } else {
            progressText.textContent = 'Ready!';
          }
        }
        
        if (percent % 25 === 0) {
          logDebug(`Load progress: ${percent}%`);
        }
      });
      
      // Load FFmpeg with timeout
      logDebug(`Starting FFmpeg.load()... (timeout: 30s)`);
      const loadStartTime = Date.now();
      const loadPromise = ffmpeg.load();
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error(`FFmpeg load timeout after 30 seconds`)), 30000)
      );
      
      await Promise.race([loadPromise, timeoutPromise]);
      const loadTime = Date.now() - loadStartTime;
      
      // Verify FFmpeg is actually working
      logDebug(`Testing FFmpeg with version check...`);
      try {
        const version = await ffmpeg.getVersion();
        logDebug(`✅ FFmpeg version: ${version}`);
      } catch (versionError) {
        logDebug(`⚠️ Could not get version, but continuing: ${versionError.message}`);
      }
      
      // Success!
      isFFmpegLoaded = true;
      successConfig = config;
      logDebug(`🎉 FFmpeg loaded successfully in ${loadTime}ms from ${config.version}`);
      logDebug(`Total attempts: ${config.priority}, Configuration: ${config.useWorker ? 'worker' : 'main thread'}`);
      logDebug(`=== loadFFmpeg() SUCCESS ===`);
      
      // Store debug log globally for troubleshooting
      if (typeof window !== 'undefined') {
        window.FFMPEG_LOAD_DEBUG = debugLog;
      }
      
      return ffmpeg;
      
    } catch (error) {
      lastError = error;
      logDebug(`❌ Failed to load from ${config.version}`);
      logDebug(`Error name: ${error.name}`);
      logDebug(`Error message: ${error.message}`);
      if (error.stack) {
        logDebug(`Error stack: ${error.stack.split('\n')[0]}`);
      }
      
      // Specific error diagnosis
      if (error.message.includes('fetch')) {
        logDebug(`🔍 Diagnosis: Network issue - CDN may be blocked`);
      } else if (error.message.includes('timeout')) {
        logDebug(`🔍 Diagnosis: Timeout - slow connection or large core file`);
      } else if (error.message.includes('WebAssembly')) {
        logDebug(`🔍 Diagnosis: WebAssembly not supported or blocked`);
      } else if (error.message.includes('memory')) {
        logDebug(`🔍 Diagnosis: Out of memory - device may have insufficient RAM`);
      }
      
      ffmpeg = null;
      // Continue to next config
    }
  }
  
  // ========== ALL ATTEMPTS FAILED ==========
  logDebug(`=== loadFFmpeg() FAILED ===`);
  logDebug(`All ${configs.length} configurations failed`);
  logDebug(`Last error: ${lastError?.message || 'Unknown error'}`);
  
  // Create comprehensive error message
  let finalErrorMessage = 'Failed to load video converter. ';
  
  if (navigator.connection && navigator.connection.saveData) {
    finalErrorMessage += 'Data saver mode may be blocking downloads. ';
  }
  
  if (navigator.deviceMemory && navigator.deviceMemory < 2) {
    finalErrorMessage += 'Your device has limited memory. ';
  }
  
  if (window.location.protocol !== 'https:' && window.location.hostname !== 'localhost') {
    finalErrorMessage += 'Video conversion requires HTTPS. ';
  }
  
  finalErrorMessage += 'Please try: 1) Using WiFi instead of mobile data, 2) Disabling ad blocker, 3) Using HEIC converter instead.';
  
  // Store debug info for support
  if (typeof window !== 'undefined') {
    window.FFMPEG_LOAD_DEBUG = debugLog;
    window.FFMPEG_LOAD_ERROR = finalErrorMessage;
    
    // Try to show error in UI
    if (window.App && window.App.showError) {
      window.App.showError(finalErrorMessage);
    }
  }
  
  throw new Error(finalErrorMessage);
}

// ============================================================================
// Video to MP3 Converter Class
// ============================================================================
class VideoToMp3Converter {
    constructor() {
        this.ffmpeg = null;
        this.videoFile = null;
        this.videoDuration = 0;
        this.mp3Blob = null;
        this.isLoaded = false;
        this.isConverting = false;
        this.progressCallback = null;
    }

    async loadFFmpeg() {
        if (this.isLoaded && this.ffmpeg) return true;

        try {
            this.ffmpeg = await loadFFmpeg();
            this.isLoaded = true;
            console.log('Video converter ready');
            return true;
        } catch (error) {
            console.error('FFmpeg load failed:', error);
            const errorMsg = error.message || 'Converter unavailable. Please ensure you are using localhost with HTTPS or a modern browser.';
            throw new Error(errorMsg);
        }
    }

    async loadVideo(file) {
        if (!file) throw new Error('No video file provided');
        
        this.videoFile = file;
        return new Promise((resolve, reject) => {
            const video = document.createElement('video');
            video.preload = 'metadata';
            
            const url = URL.createObjectURL(file);
            
            video.onloadedmetadata = () => {
                URL.revokeObjectURL(url);
                this.videoDuration = video.duration;
                console.log(`Video loaded: ${this.videoDuration.toFixed(2)}s, ${(file.size / 1024 / 1024).toFixed(2)} MB`);
                resolve(this.videoDuration);
            };
            
            video.onerror = () => {
                URL.revokeObjectURL(url);
                reject(new Error('Cannot read video file. The file may be corrupted or unsupported.'));
            };
            
            video.src = url;
        });
    }

    getTrimTimes() {
        const startSlider = document.getElementById('trimStart');
        const endSlider = document.getElementById('trimEnd');
        
        let startPercent = startSlider ? parseFloat(startSlider.value) : 0;
        let endPercent = endSlider ? parseFloat(endSlider.value) : 100;
        
        // Validate values
        if (isNaN(startPercent)) startPercent = 0;
        if (isNaN(endPercent)) endPercent = 100;
        
        // Ensure start < end
        if (startPercent >= endPercent) {
            endPercent = Math.min(startPercent + 5, 100);
            if (endSlider) endSlider.value = endPercent;
        }
        
        let startTime = (startPercent / 100) * this.videoDuration;
        let endTime = (endPercent / 100) * this.videoDuration;
        
        // Ensure minimum duration of 1 second
        if (endTime - startTime < 1) {
            endTime = Math.min(startTime + 1, this.videoDuration);
        }
        
        return { startTime, endTime };
    }

    async convertToMp3(startTime, endTime) {
        if (!this.isLoaded) {
            await this.loadFFmpeg();
        }
        
        if (!this.videoFile) {
            throw new Error('No video file loaded');
        }
        
        if (this.isConverting) {
            throw new Error('Conversion already in progress');
        }
        
        this.isConverting = true;
        
        const ff = this.ffmpeg;
        const extension = this.videoFile.name.split('.').pop()?.toLowerCase() || 'mp4';
        const inputFilename = `input.${extension}`;
        const outputFilename = 'output.mp3';
        
        try {
            // Update progress UI
            const progressText = document.getElementById('videoProgressText');
            if (progressText) progressText.textContent = 'Loading video...';
            
            // Read video file
            console.log(`Loading video: ${this.videoFile.name} (${(this.videoFile.size / 1024 / 1024).toFixed(2)} MB)`);
            const videoData = await this.videoFile.arrayBuffer();
            ff.FS('writeFile', inputFilename, new Uint8Array(videoData));
            
            // Build FFmpeg command
            const command = [];
            
            // Seek to start time (if not at beginning)
            if (startTime > 0.1) {
                command.push('-ss', startTime.toFixed(3));
            }
            
            // Input file
            command.push('-i', inputFilename);
            
            // Duration limit (if not at end)
            const duration = endTime - startTime;
            if (duration < this.videoDuration - 0.1) {
                command.push('-t', duration.toFixed(3));
            }
            
            // Audio encoding options
            command.push(
                '-vn',           // No video
                '-acodec', 'libmp3lame',  // MP3 codec
                '-ab', '192k',   // Bitrate 192 kbps
                '-ar', '44100',  // Sample rate 44.1 kHz
                '-ac', '2',      // Stereo
                outputFilename
            );
            
            console.log('FFmpeg command:', command.join(' '));
            
            // Update progress text
            if (progressText) progressText.textContent = 'Converting to MP3...';
            
            // Run conversion
            await ff.run(...command);
            
            // Read output file
            console.log('Reading output file...');
            const outputData = ff.FS('readFile', outputFilename);
            this.mp3Blob = new Blob([outputData.buffer], { type: 'audio/mpeg' });
            
            // Clean up
            ff.FS('unlink', inputFilename);
            ff.FS('unlink', outputFilename);
            
            console.log(`Conversion complete: ${(this.mp3Blob.size / 1024).toFixed(0)} KB MP3`);
            return this.mp3Blob;
            
        } catch (error) {
            console.error('Conversion error:', error);
            
            // Clean up files if they exist
            try { ff.FS('unlink', inputFilename); } catch(e) {}
            try { ff.FS('unlink', outputFilename); } catch(e) {}
            
            // Provide user-friendly error message
            let errorMessage = 'Conversion failed. ';
            if (error.message.includes('timeout')) {
                errorMessage += 'The video is too large or conversion took too long.';
            } else if (error.message.includes('memory')) {
                errorMessage += 'The video is too large to process in browser memory.';
            } else {
                errorMessage += 'Please try a different video format (MP4 works best).';
            }
            
            throw new Error(errorMessage);
        } finally {
            this.isConverting = false;
        }
    }
    
    getMp3Blob() {
        return this.mp3Blob;
    }
    
    reset() {
        this.videoFile = null;
        this.videoDuration = 0;
        this.mp3Blob = null;
        this.isConverting = false;
        
        // Reset UI elements
        const startSlider = document.getElementById('trimStart');
        const endSlider = document.getElementById('trimEnd');
        const progressBar = document.getElementById('videoProgressBar');
        const progressPercent = document.getElementById('videoProgressPercent');
        const progressText = document.getElementById('videoProgressText');
        
        if (startSlider) startSlider.value = 0;
        if (endSlider) endSlider.value = 100;
        if (progressBar) progressBar.style.width = '0%';
        if (progressPercent) progressPercent.textContent = '0%';
        if (progressText) progressText.textContent = '';
    }
    
    isReady() {
        return this.isLoaded && !this.isConverting;
    }
}

// Create global instance
const videoConverter = new VideoToMp3Converter();

// Export for global use
if (typeof window !== 'undefined') {
    window.videoConverter = videoConverter;
    window.VideoToMp3Converter = VideoToMp3Converter;
    window.loadFFmpeg = loadFFmpeg;
}

// ============================================================================
// Video Converter Initialization Function
// ============================================================================
function initVideoConverter() {
    console.log('Initializing video converter...');
    
    // Get DOM elements with null checks
    const videoUploadZone = document.getElementById('videoUploadZone');
    const videoFileInput = document.getElementById('videoFileInput');
    const videoSection = document.getElementById('videoSection');
    const videoPreview = document.getElementById('videoPreview');
    const trimStart = document.getElementById('trimStart');
    const trimEnd = document.getElementById('trimEnd');
    const trimStartLabel = document.getElementById('trimStartLabel');
    const trimEndLabel = document.getElementById('trimEndLabel');
    const trimDuration = document.getElementById('trimDuration');
    const resetTrimBtn = document.getElementById('resetTrimBtn');
    const videoConvertBtn = document.getElementById('videoConvertBtn');
    const videoClearBtn = document.getElementById('videoClearBtn');
    const videoProgress = document.getElementById('videoProgress');
    const videoDownloadReady = document.getElementById('videoDownloadReady');
    const videoDownloadBtn = document.getElementById('videoDownloadBtn');
    
    // Check if required elements exist
    if (!videoUploadZone || !videoFileInput) {
        console.warn('Video converter elements not found, skipping initialization');
        return;
    }
    
    let currentVideoFile = null;
    let currentDuration = 0;
    
    // Store original button HTML
    const originalBtnHTML = videoConvertBtn ? videoConvertBtn.innerHTML : 'Convert to MP3';
    
    // Helper to update trim labels
    function updateTrimLabels() {
        if (!trimStart || !trimEnd || !trimStartLabel || !trimEndLabel || !trimDuration) return;
        
        const startPercent = parseFloat(trimStart.value) || 0;
        const endPercent = parseFloat(trimEnd.value) || 100;
        const startTime = (startPercent / 100) * currentDuration;
        const endTime = (endPercent / 100) * currentDuration;
        
        trimStartLabel.textContent = startTime.toFixed(1) + 's';
        trimEndLabel.textContent = endTime.toFixed(1) + 's';
        trimDuration.textContent = (endTime - startTime).toFixed(1) + 's';
        
        // Update video preview time if playing
        if (videoPreview && videoPreview.readyState >= 1) {
            videoPreview.currentTime = startTime;
        }
    }
    
    // Upload zone click
    videoUploadZone.addEventListener('click', () => videoFileInput.click());
    
    // File input change
    videoFileInput.addEventListener('change', (e) => {
        if (e.target.files && e.target.files[0]) {
            loadVideoFile(e.target.files[0]);
        }
        e.target.value = '';
    });
    
    // Drag and drop
    ['dragover', 'dragleave', 'drop'].forEach(evt => {
        videoUploadZone.addEventListener(evt, (e) => {
            e.preventDefault();
            if (evt === 'dragover') {
                videoUploadZone.classList.add('drag-over');
            } else if (evt === 'dragleave') {
                videoUploadZone.classList.remove('drag-over');
            } else if (evt === 'drop') {
                videoUploadZone.classList.remove('drag-over');
                const file = e.dataTransfer.files[0];
                if (file) loadVideoFile(file);
            }
        });
    });
    
    // Load video file
    async function loadVideoFile(file) {
        const ext = file.name.split('.').pop()?.toLowerCase();
        const validExts = ['mp4', 'mov', 'avi', 'webm', 'mkv', 'm4v', 'mpg', 'mpeg'];
        
        if (!validExts.includes(ext)) {
            if (window.App) {
                window.App.showError('Please select a video file (MP4, MOV, AVI, WebM, MKV).');
            } else {
                alert('Please select a video file (MP4, MOV, AVI, WebM, MKV).');
            }
            return;
        }
        
        if (file.size > 200 * 1024 * 1024) {
            if (window.App) {
                window.App.showError('Video must be under 200MB.');
            } else {
                alert('Video must be under 200MB.');
            }
            return;
        }
        
        currentVideoFile = file;
        const url = URL.createObjectURL(file);
        
        if (videoPreview) {
            videoPreview.src = url;
        }
        
        if (videoSection) {
            videoSection.style.display = 'block';
        }
        
        if (videoProgress) {
            videoProgress.style.display = 'none';
        }
        
        if (videoDownloadReady) {
            videoDownloadReady.style.display = 'none';
        }
        
        if (videoPreview) {
            videoPreview.onloadedmetadata = () => {
                currentDuration = videoPreview.duration;
                if (trimStart) trimStart.max = 100;
                if (trimEnd) trimEnd.max = 100;
                if (trimEnd) trimEnd.value = 100;
                if (trimStart) trimStart.value = 0;
                updateTrimLabels();
                
                console.log(`Video loaded: ${currentDuration.toFixed(2)} seconds`);
            };
        }
        
        if (videoPreview) {
            videoPreview.scrollIntoView({ behavior: 'smooth' });
        }
        
        if (window.App && window.App.hideError) {
            window.App.hideError();
        }
        
        // Reset converter state
        videoConverter.reset();
    }
    
    // Trim sliders
    if (trimStart) {
        trimStart.addEventListener('input', updateTrimLabels);
    }
    
    if (trimEnd) {
        trimEnd.addEventListener('input', updateTrimLabels);
    }
    
    if (trimStart && videoPreview) {
        trimStart.addEventListener('change', () => {
            if (videoPreview.readyState >= 1) {
                const startPercent = parseFloat(trimStart.value) || 0;
                videoPreview.currentTime = (startPercent / 100) * currentDuration;
            }
        });
    }
    
    if (trimEnd && videoPreview) {
        trimEnd.addEventListener('change', () => {
            if (videoPreview.readyState >= 1) {
                const endPercent = parseFloat(trimEnd.value) || 100;
                videoPreview.currentTime = (endPercent / 100) * currentDuration;
            }
        });
    }
    
    // Reset trim
    if (resetTrimBtn) {
        resetTrimBtn.addEventListener('click', () => {
            if (trimStart) trimStart.value = 0;
            if (trimEnd) trimEnd.value = 100;
            updateTrimLabels();
            if (videoPreview && videoPreview.readyState >= 1) {
                videoPreview.currentTime = 0;
            }
        });
    }
    
    // Convert to MP3
    if (videoConvertBtn) {
        videoConvertBtn.addEventListener('click', async () => {
            if (!currentVideoFile) {
                if (window.App) window.App.showError('Please select a video file first.');
                return;
            }
            
            if (videoConverter.isConverting) {
                if (window.App) window.App.showError('Conversion already in progress. Please wait.');
                return;
            }
            
            videoConvertBtn.disabled = true;
            videoConvertBtn.innerHTML = '<span class="spinner"></span> Loading converter...';
            
            if (videoProgress) videoProgress.style.display = 'block';
            if (videoDownloadReady) videoDownloadReady.style.display = 'none';
            
            const progressBar = document.getElementById('videoProgressBar');
            const progressPercent = document.getElementById('videoProgressPercent');
            const progressText = document.getElementById('videoProgressText');
            
            if (progressBar) progressBar.style.width = '0%';
            if (progressPercent) progressPercent.textContent = '0%';
            if (progressText) progressText.textContent = 'Preparing...';
            
            try {
                // Load FFmpeg
                videoConvertBtn.innerHTML = '<span class="spinner"></span> Loading...';
                await videoConverter.loadFFmpeg();
                
                // Load video
                videoConvertBtn.innerHTML = '<span class="spinner"></span> Loading video...';
                await videoConverter.loadVideo(currentVideoFile);
                
                // Get trim times
                const { startTime, endTime } = videoConverter.getTrimTimes();
                console.log(`Trimming: ${startTime.toFixed(1)}s to ${endTime.toFixed(1)}s (${(endTime - startTime).toFixed(1)}s duration)`);
                
                // Convert
                videoConvertBtn.innerHTML = '<span class="spinner"></span> Converting to MP3...';
                await videoConverter.convertToMp3(startTime, endTime);
                
                // Hide progress, show download
                if (videoProgress) videoProgress.style.display = 'none';
                if (videoDownloadReady) videoDownloadReady.style.display = 'block';
                
                // Auto-download
                const mp3Name = (currentVideoFile?.name || 'audio').replace(/\.[^.]+$/, '') + '.mp3';
                if (window.App) {
                    window.App.downloadBlob(videoConverter.getMp3Blob(), mp3Name);
                } else {
                    // Fallback download
                    const url = URL.createObjectURL(videoConverter.getMp3Blob());
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = mp3Name;
                    a.click();
                    setTimeout(() => URL.revokeObjectURL(url), 1000);
                }
                
                // Update stats
                if (window.StatsStore) {
                    window.StatsStore.increment(1);
                    const todayCount = document.getElementById('todayCount');
                    if (todayCount) todayCount.textContent = window.StatsStore.getToday();
                }
                
                // Show feedback modal
                if (window.App) {
                    setTimeout(() => window.App.showFeedbackModal(), 1500);
                }
                
                console.log('Conversion completed successfully');
                
            } catch (error) {
                console.error('Conversion failed:', error);
                if (window.App) {
                    window.App.showError(error.message || 'Conversion failed. Please try again with an MP4 file.');
                }
                if (videoProgress) videoProgress.style.display = 'none';
            } finally {
                videoConvertBtn.disabled = false;
                videoConvertBtn.innerHTML = originalBtnHTML;
            }
        });
    }
    
    // Manual download button (backup)
    if (videoDownloadBtn) {
        videoDownloadBtn.addEventListener('click', () => {
            const blob = videoConverter.getMp3Blob();
            if (blob && currentVideoFile) {
                const name = currentVideoFile.name.replace(/\.[^.]+$/, '') + '.mp3';
                if (window.App) {
                    window.App.downloadBlob(blob, name);
                } else {
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = name;
                    a.click();
                    setTimeout(() => URL.revokeObjectURL(url), 1000);
                }
            }
        });
    }
    
    // Clear / choose different video
    if (videoClearBtn) {
        videoClearBtn.addEventListener('click', () => {
            currentVideoFile = null;
            if (videoPreview) videoPreview.src = '';
            if (videoSection) videoSection.style.display = 'none';
            if (videoProgress) videoProgress.style.display = 'none';
            if (videoDownloadReady) videoDownloadReady.style.display = 'none';
            videoConverter.reset();
        });
    }
    
    console.log('Video converter initialized');
}

// Export for global use
if (typeof window !== 'undefined') {
    window.initVideoConverter = initVideoConverter;
}