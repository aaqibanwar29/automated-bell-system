// Configuration - Enhanced with professional settings
const CONFIG = {
    APP_NAME: 'Smart Bell System',
    VERSION: '2.1.4',
    MQTT_BROKER: 'your-instance.hivemq.cloud',
    MQTT_PORT: 8883,
    MQTT_TOPICS: {
        SCHEDULE_UPDATE: 'bell/schedule/update',
        RING_NOW: 'bell/ring/now',
        STATUS: 'bell/status/update',
        SYSTEM_HEALTH: 'bell/system/health'
    },
    API_URL: '/.netlify/functions',
    REFRESH_INTERVAL: 30000, // 30 seconds
    BELL_VALIDATION: {
        MIN_DURATION: 1,
        MAX_DURATION: 30,
        MIN_TIME_GAP: 300 // 5 minutes between bells
    }
};

// Global State Management
const AppState = {
    user: null,
    mqttClient: null,
    isExamMode: false,
    expandedDay: null,
    daysSchedule: {
        "Monday": { enabled: false, periods: [] },
        "Tuesday": { enabled: false, periods: [] },
        "Wednesday": { enabled: false, periods: [] },
        "Thursday": { enabled: false, periods: [] },
        "Friday": { enabled: false, periods: [] },
        "Saturday": { enabled: false, periods: [] },
        "Sunday": { enabled: false, periods: [] },
        "Exam Day": { enabled: false, periods: [] }
    },
    lastBellTimestamp: null,
    systemStatus: {
        wifi: 'connected',
        mqtt: 'connected',
        lastSync: null,
        nextBell: null
    }
};

// Initialize Application
document.addEventListener('DOMContentLoaded', function () {
    console.log(`${CONFIG.APP_NAME} v${CONFIG.VERSION} initializing...`);
    initializeApplication();
});

async function initializeApplication() {
    try {
        initNetlifyIdentity();
        setupEventListeners();
        initializeUI();
        startSystemTimers();
        
        console.log('Application initialized successfully');
        showSystemNotification('System ready', 'System initialized successfully', 'success');
    } catch (error) {
        console.error('Initialization error:', error);
        showSystemNotification('Initialization Error', 'Failed to initialize application', 'error');
    }
}

// Netlify Identity Management
function initNetlifyIdentity() {
    if (window.netlifyIdentity) {
        window.netlifyIdentity.on('init', user => {
            if (user) {
                handleUserLogin(user);
            }
        });

        window.netlifyIdentity.on('login', handleUserLogin);
        window.netlifyIdentity.on('logout', handleUserLogout);
        window.netlifyIdentity.on('error', error => {
            console.error('Netlify Identity Error:', error);
            showSystemNotification('Authentication Error', 'Please try logging in again', 'error');
        });
    }

    // Check for existing session
    const currentUser = netlifyIdentity?.currentUser();
    if (currentUser) {
        handleUserLogin(currentUser);
    }
}

function handleUserLogin(userData) {
    if (!userData) return;
    
    AppState.user = userData;
    console.log(`User logged in: ${userData.email}`);
    
    // Update UI
    document.getElementById('loginScreen').style.display = 'none';
    document.getElementById('dashboard').style.display = 'flex';
    
    // Initialize dashboard
    connectToMQTT();
    loadSchedule();
    updateDashboardWelcome();
    
    showSystemNotification('Welcome Back', `Logged in as ${userData.email}`, 'success');
}

function handleUserLogout() {
    console.log('User logged out');
    AppState.user = null;
    
    // Clean up connections
    if (AppState.mqttClient && AppState.mqttClient.connected) {
        AppState.mqttClient.end();
    }
    
    // Reset UI
    document.getElementById('loginScreen').style.display = 'block';
    document.getElementById('dashboard').style.display = 'none';
    
    showSystemNotification('Logged Out', 'You have been successfully logged out', 'info');
}

// Event Listeners Setup
function setupEventListeners() {
    // Login Button
    document.getElementById('googleLogin')?.addEventListener('click', () => {
        netlifyIdentity.open('login');
    });

    // Logout Button
    document.getElementById('logoutBtn')?.addEventListener('click', () => {
        if (confirm('Are you sure you want to log out of the system?')) {
            netlifyIdentity.logout();
        }
    });

    // Manual Bell Ring
    document.getElementById('ringNowBtn')?.addEventListener('click', ringBellNow);

    // Duration Slider Sync
    const durationSlider = document.getElementById('durationSlider');
    const manualDuration = document.getElementById('manualDuration');
    
    if (durationSlider && manualDuration) {
        durationSlider.addEventListener('input', (e) => {
            manualDuration.value = e.target.value;
        });
        
        manualDuration.addEventListener('input', (e) => {
            const value = Math.min(Math.max(e.target.value, 1), 30);
            durationSlider.value = value;
            e.target.value = value;
        });
    }

    // Modal Management
    document.querySelectorAll('.modal-close, .cancel-btn').forEach(btn => {
        btn.addEventListener('click', closePeriodModal);
    });

    // Period Form Submission
    document.getElementById('periodForm')?.addEventListener('submit', handlePeriodSave);

    // Schedule Mode Tabs
    document.querySelectorAll('.mode-tab').forEach(tab => {
        tab.addEventListener('click', (e) => {
            const mode = e.currentTarget.dataset.mode;
            switchScheduleMode(mode);
        });
    });

    // Toggle All Days
    document.getElementById('toggleAllBtn')?.addEventListener('click', toggleAllDays);

    // Clear All Periods
    document.getElementById('clearAllBtn')?.addEventListener('click', clearAllPeriods);

    // Close modal on outside click
    window.addEventListener('click', (e) => {
        if (e.target.classList.contains('modal-overlay')) {
            closePeriodModal();
        }
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            closePeriodModal();
        }
        if (e.ctrlKey && e.key === 'r' && AppState.user) {
            e.preventDefault();
            ringBellNow();
        }
    });
}

// MQTT Connection Management
function connectToMQTT() {
    console.log('Connecting to MQTT broker...');
    updateSystemStatus('mqtt', 'connecting');
    
    // Simulated connection - Replace with actual MQTT implementation
    setTimeout(() => {
        updateSystemStatus('mqtt', 'connected');
        simulateMQTTConnection();
        showSystemNotification('MQTT Connected', 'Successfully connected to MQTT broker', 'success');
    }, 1500);
}

function simulateMQTTConnection() {
    // Simulate real-time updates
    setInterval(() => {
        const statuses = ['connected', 'disconnected', 'bell_triggered'];
        const randomStatus = statuses[Math.floor(Math.random() * statuses.length)];
        
        updateSystemStatus('mqtt', randomStatus);
        
        if (randomStatus === 'bell_triggered') {
            updateLastBellTime();
            showSystemNotification('Bell Activated', 'Bell was triggered remotely', 'info');
        }
    }, 15000);
}

// Schedule Management
async function loadSchedule() {
    try {
        console.log('Loading schedule from database...');
        updateSystemStatus('lastSync', 'syncing');
        
        const response = await fetch(`${CONFIG.API_URL}/getSchedule`);
        
        if (!response.ok) {
            throw new Error(`Server returned ${response.status}`);
        }
        
        const result = await response.json();
        
        if (result.schedule?.periods) {
            resetScheduleState();
            
            // Process schedule data
            result.schedule.periods.forEach(period => {
                if (AppState.daysSchedule[period.day]) {
                    AppState.daysSchedule[period.day].periods.push(period);
                    AppState.daysSchedule[period.day].enabled = true;
                }
            });
            
            // Check for exam mode
            AppState.isExamMode = result.schedule.periods.some(p => p.day === 'Exam Day');
            
            // Update UI
            renderDaysList();
            updatePeriodsCount();
            calculateNextBell();
            
            console.log(`Schedule loaded: ${result.schedule.periods.length} periods`);
            showSystemNotification('Schedule Loaded', 
                `Loaded ${result.schedule.periods.length} periods`, 'success');
        }
        
        updateSystemStatus('lastSync', new Date().toISOString());
        
    } catch (error) {
        console.error('Error loading schedule:', error);
        showSystemNotification('Schedule Error', 
            'Failed to load schedule. Using default configuration.', 'error');
        
        // Initialize with empty schedule
        renderDaysList();
    }
}

function renderDaysList() {
    const scheduleList = document.getElementById('scheduleList');
    if (!scheduleList) return;
    
    scheduleList.innerHTML = '';
    
    // Create day cards
    Object.keys(AppState.daysSchedule).forEach(dayName => {
        const dayCard = createDayCard(dayName);
        scheduleList.appendChild(dayCard);
    });
    
    // Update mode display
    updateModeDisplay();
}

function createDayCard(dayName) {
    const day = AppState.daysSchedule[dayName];
    const periodCount = day.periods.length;
    const isExpanded = AppState.expandedDay === dayName;
    const isExamDay = dayName === 'Exam Day';
    
    const dayCard = document.createElement('div');
    dayCard.className = `day-card ${day.enabled ? 'active' : ''} ${isExamDay && AppState.isExamMode ? 'exam-mode' : ''} ${isExpanded ? 'day-expanded' : ''}`;
    dayCard.id = `day-${dayName.replace(/\s+/g, '-').toLowerCase()}`;
    
    dayCard.innerHTML = `
        <div class="day-header" onclick="toggleDayExpansion('${dayName}')">
            <div class="day-info">
                <i class="fas fa-chevron-right day-icon"></i>
                <span class="day-title">${dayName}</span>
                <span class="period-count">${periodCount} period${periodCount !== 1 ? 's' : ''}</span>
            </div>
            <div class="day-controls">
                <label class="toggle-switch">
                    <input type="checkbox" ${day.enabled ? 'checked' : ''} 
                           onchange="toggleDayState('${dayName}', this.checked)">
                    <span class="toggle-slider"></span>
                </label>
                <button class="add-period-btn" onclick="openAddPeriodModal('${dayName}')">
                    <i class="fas fa-plus"></i>
                </button>
            </div>
        </div>
        <div class="periods-container">
            ${renderPeriodsForDay(dayName)}
        </div>
    `;
    
    return dayCard;
}

function renderPeriodsForDay(dayName) {
    const periods = AppState.daysSchedule[dayName].periods;
    
    if (periods.length === 0) {
        return '<div class="period-item"><div class="period-info"><p>No periods configured</p></div></div>';
    }
    
    return periods.map((period, index) => `
        <div class="period-item">
            <div class="period-info">
                <h4>${period.name || `Period ${index + 1}`}</h4>
                <div class="period-time">
                    <i class="far fa-clock"></i> ${formatTime(period.startTime)} - ${formatTime(period.endTime)}
                    <span class="duration">(${period.duration}s)</span>
                </div>
            </div>
            <div class="period-actions">
                <button class="delete-period-btn" onclick="deletePeriodFromDay('${dayName}', ${index})">
                    <i class="fas fa-trash"></i>
                </button>
            </div>
        </div>
    `).join('');
}

// Schedule Mode Management
function switchScheduleMode(mode) {
    if (mode === 'exam' && !AppState.isExamMode) {
        if (confirm('Switch to Exam Mode? This will disable all regular days.')) {
            AppState.isExamMode = true;
            enableExamMode();
            showSystemNotification('Exam Mode Activated', 'Regular days disabled', 'warning');
        }
    } else if (mode === 'regular' && AppState.isExamMode) {
        AppState.isExamMode = false;
        disableExamMode();
        showSystemNotification('Regular Mode Activated', 'Exam day disabled', 'success');
    }
    
    updateModeDisplay();
}

function enableExamMode() {
    Object.keys(AppState.daysSchedule).forEach(dayName => {
        if (dayName !== 'Exam Day') {
            AppState.daysSchedule[dayName].enabled = false;
        }
    });
    AppState.daysSchedule['Exam Day'].enabled = true;
    renderDaysList();
    updateScheduleInDatabase();
}

function disableExamMode() {
    AppState.daysSchedule['Exam Day'].enabled = false;
    renderDaysList();
    updateScheduleInDatabase();
}

// Day Management
function toggleDayExpansion(dayName) {
    const dayCard = document.getElementById(`day-${dayName.replace(/\s+/g, '-').toLowerCase()}`);
    
    if (AppState.expandedDay === dayName) {
        dayCard.classList.remove('day-expanded');
        AppState.expandedDay = null;
    } else {
        if (AppState.expandedDay) {
            const prevCard = document.getElementById(`day-${AppState.expandedDay.replace(/\s+/g, '-').toLowerCase()}`);
            prevCard.classList.remove('day-expanded');
        }
        dayCard.classList.add('day-expanded');
        AppState.expandedDay = dayName;
    }
}

async function toggleDayState(dayName, enabled) {
    if (AppState.isExamMode && dayName !== 'Exam Day' && enabled) {
        showSystemNotification('Mode Conflict', 
            'Cannot enable regular days in Exam Mode. Disable Exam Day first.', 'error');
        
        // Revert checkbox
        const checkbox = document.querySelector(`#day-${dayName.replace(/\s+/g, '-').toLowerCase()} input[type="checkbox"]`);
        checkbox.checked = false;
        return;
    }
    
    if (dayName === 'Exam Day' && enabled) {
        // Enable exam mode
        await enableExamMode();
        return;
    }
    
    AppState.daysSchedule[dayName].enabled = enabled;
    updateDayCard(dayName);
    
    if (enabled) {
        await updateScheduleInDatabase();
    } else {
        await clearDayFromDatabase(dayName);
    }
    
    showSystemNotification('Schedule Updated', 
        `${dayName} ${enabled ? 'enabled' : 'disabled'}`, 'success');
}

async function toggleAllDays() {
    const allEnabled = Object.keys(AppState.daysSchedule).every(day => 
        day === 'Exam Day' ? true : AppState.daysSchedule[day].enabled
    );
    
    const daysToToggle = Object.keys(AppState.daysSchedule).filter(day => day !== 'Exam Day');
    
    await Promise.all(daysToToggle.map(async (dayName) => {
        AppState.daysSchedule[dayName].enabled = !allEnabled;
        updateDayCard(dayName);
    }));
    
    await updateScheduleInDatabase();
    
    showSystemNotification('Schedule Updated', 
        `${allEnabled ? 'Disabled' : 'Enabled'} all days`, 'success');
}

async function clearAllPeriods() {
    if (!confirm('Are you sure you want to clear ALL periods from ALL days? This action cannot be undone.')) {
        return;
    }
    
    try {
        Object.keys(AppState.daysSchedule).forEach(dayName => {
            AppState.daysSchedule[dayName].periods = [];
        });
        
        await clearDatabaseAndUpdateSchedule();
        renderDaysList();
        
        showSystemNotification('Schedule Cleared', 'All periods removed successfully', 'success');
    } catch (error) {
        console.error('Error clearing periods:', error);
        showSystemNotification('Clear Failed', 'Failed to clear periods', 'error');
    }
}

// Period Management
function openAddPeriodModal(dayName) {
    document.getElementById('addPeriodModal').style.display = 'flex';
    document.getElementById('selectedDay').value = dayName;
    document.getElementById('periodDay').value = dayName;
    
    // Set focus to first input
    setTimeout(() => {
        document.getElementById('periodName').focus();
    }, 100);
}

function closePeriodModal() {
    document.getElementById('addPeriodModal').style.display = 'none';
    document.getElementById('periodForm').reset();
}

async function handlePeriodSave(e) {
    e.preventDefault();
    
    const dayName = document.getElementById('periodDay').value;
    if (!dayName) {
        showSystemNotification('Validation Error', 'Please select a day', 'error');
        return;
    }
    
    const period = {
        name: document.getElementById('periodName').value.trim(),
        day: dayName,
        startTime: document.getElementById('startTime').value,
        endTime: document.getElementById('endTime').value,
        duration: parseInt(document.getElementById('bellDuration').value) || 5
    };
    
    // Validation
    if (period.startTime >= period.endTime) {
        showSystemNotification('Time Error', 'End time must be after start time', 'error');
        return;
    }
    
    if (period.duration < 1 || period.duration > 30) {
        showSystemNotification('Duration Error', 'Bell duration must be between 1-30 seconds', 'error');
        return;
    }
    
    // Add period
    AppState.daysSchedule[dayName].periods.push(period);
    updateDayCard(dayName);
    
    // Save to database
    if (AppState.daysSchedule[dayName].enabled) {
        await updateScheduleInDatabase();
    }
    
    closePeriodModal();
    showSystemNotification('Period Saved', 'Period added successfully', 'success');
}

async function deletePeriodFromDay(dayName, periodIndex) {
    if (!confirm('Delete this period?')) {
        return;
    }
    
    AppState.daysSchedule[dayName].periods.splice(periodIndex, 1);
    updateDayCard(dayName);
    
    if (AppState.daysSchedule[dayName].enabled) {
        await updateScheduleInDatabase();
    }
    
    showSystemNotification('Period Deleted', 'Period removed successfully', 'success');
}

// Manual Bell Control
async function ringBellNow() {
    const duration = parseInt(document.getElementById('manualDuration').value) || 5;
    
    if (duration < 1 || duration > 30) {
        showSystemNotification('Invalid Duration', 'Please enter a duration between 1-30 seconds', 'error');
        return;
    }
    
    try {
        showSystemNotification('Activating Bell', 'Sending bell activation command...', 'info');
        
        const response = await fetch(`${CONFIG.API_URL}/ringNow`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${AppState.user?.token?.access_token}`
            },
            body: JSON.stringify({ 
                duration,
                timestamp: new Date().toISOString(),
                triggeredBy: AppState.user?.email || 'manual'
            })
        });
        
        if (!response.ok) {
            throw new Error(`Server responded with ${response.status}`);
        }
        
        updateLastBellTime();
        showSystemNotification('Bell Activated', `Bell rung for ${duration} seconds`, 'success');
        
    } catch (error) {
        console.error('Error ringing bell:', error);
        showSystemNotification('Activation Failed', 'Failed to ring bell. Please try again.', 'error');
    }
}

// Database Operations
async function updateScheduleInDatabase() {
    const periods = getAllEnabledPeriods();
    
    if (periods.length === 0) {
        showSystemNotification('No Periods', 'No enabled periods to save', 'warning');
        return;
    }
    
    try {
        const response = await fetch(`${CONFIG.API_URL}/scheduleQueue`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${AppState.user?.token?.access_token}`
            },
            body: JSON.stringify({
                periods: periods,
                timestamp: new Date().toISOString(),
                mode: AppState.isExamMode ? 'exam' : 'regular',
                totalPeriods: periods.length
            })
        });
        
        if (response.status === 401 || response.status === 403) {
            showSystemNotification('Session Expired', 'Please log in again', 'error');
            netlifyIdentity.logout();
            return;
        }
        
        if (!response.ok) {
            throw new Error('Failed to update schedule');
        }
        
        console.log(`Schedule updated with ${periods.length} periods`);
        
        // Update ESP32
        await sendScheduleToESP32();
        
    } catch (error) {
        console.error('Error updating schedule:', error);
        showSystemNotification('Update Failed', 'Failed to save schedule changes', 'error');
    }
}

async function sendScheduleToESP32() {
    try {
        const periods = getAllEnabledPeriods();
        
        // Simulated ESP32 update
        console.log(`Sending ${periods.length} periods to ESP32...`);
        
        // In production, implement actual MQTT or HTTP call to ESP32
        showSystemNotification('Schedule Sent', `Sent schedule to bell controller (${periods.length} periods)`, 'success');
        
    } catch (error) {
        console.error('Error sending to ESP32:', error);
        showSystemNotification('Sync Warning', 'Schedule saved but ESP32 sync failed', 'warning');
    }
}

async function clearDatabaseAndUpdateSchedule() {
    try {
        const response = await fetch(`${CONFIG.API_URL}/clearSchedule`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${AppState.user?.token?.access_token}`
            }
        });
        
        if (!response.ok) {
            throw new Error('Failed to clear schedule');
        }
        
        await updateScheduleInDatabase();
        
    } catch (error) {
        console.error('Error clearing schedule:', error);
        showSystemNotification('Clear Failed', 'Failed to clear schedule', 'error');
    }
}

async function clearDayFromDatabase(dayName) {
    try {
        const response = await fetch(`${CONFIG.API_URL}/clearDay`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${AppState.user?.token?.access_token}`
            },
            body: JSON.stringify({ day: dayName })
        });
        
        if (!response.ok) {
            throw new Error('Failed to clear day');
        }
        
    } catch (error) {
        console.error('Error clearing day:', error);
    }
}

// Helper Functions
function getAllEnabledPeriods() {
    const allPeriods = [];
    
    Object.keys(AppState.daysSchedule).forEach(dayName => {
        if (AppState.daysSchedule[dayName].enabled) {
            AppState.daysSchedule[dayName].periods.forEach(period => {
                allPeriods.push({
                    ...period,
                    day: dayName
                });
            });
        }
    });
    
    return allPeriods;
}

function resetScheduleState() {
    Object.keys(AppState.daysSchedule).forEach(dayName => {
        AppState.daysSchedule[dayName].periods = [];
        AppState.daysSchedule[dayName].enabled = false;
    });
}

function updateDayCard(dayName) {
    const dayCard = document.getElementById(`day-${dayName.replace(/\s+/g, '-').toLowerCase()}`);
    const newDayCard = createDayCard(dayName);
    
    if (dayCard.classList.contains('day-expanded')) {
        newDayCard.classList.add('day-expanded');
    }
    
    dayCard.replaceWith(newDayCard);
    updatePeriodsCount();
    calculateNextBell();
}

function updatePeriodsCount() {
    const totalPeriods = Object.keys(AppState.daysSchedule).reduce((total, dayName) => {
        return total + AppState.daysSchedule[dayName].periods.length;
    }, 0);
    
    document.getElementById('periodsCount').textContent = totalPeriods;
}

function calculateNextBell() {
    const now = new Date();
    const currentDay = now.toLocaleDateString('en-US', { weekday: 'long' });
    const currentTime = now.getHours() * 60 + now.getMinutes();
    
    let nextBell = null;
    
    // Check today's schedule
    if (AppState.daysSchedule[currentDay]?.enabled) {
        for (const period of AppState.daysSchedule[currentDay].periods) {
            const [startHour, startMinute] = period.startTime.split(':').map(Number);
            const startTime = startHour * 60 + startMinute;
            
            if (startTime > currentTime) {
                if (!nextBell || startTime < nextBell.startTime) {
                    nextBell = {
                        time: period.startTime,
                        startTime: startTime,
                        day: currentDay
                    };
                }
            }
        }
    }
    
    // Check upcoming days
    if (!nextBell) {
        const days = Object.keys(AppState.daysSchedule);
        const currentDayIndex = days.indexOf(currentDay);
        
        for (let i = 1; i <= days.length; i++) {
            const nextDayIndex = (currentDayIndex + i) % days.length;
            const nextDay = days[nextDayIndex];
            
            if (AppState.daysSchedule[nextDay]?.enabled && AppState.daysSchedule[nextDay].periods.length > 0) {
                const earliestPeriod = AppState.daysSchedule[nextDay].periods.reduce((earliest, period) => {
                    const [startHour, startMinute] = period.startTime.split(':').map(Number);
                    const startTime = startHour * 60 + startMinute;
                    return !earliest || startTime < earliest.startTime ? 
                        { time: period.startTime, startTime: startTime, day: nextDay } : earliest;
                }, null);
                
                if (earliestPeriod) {
                    nextBell = earliestPeriod;
                    break;
                }
            }
        }
    }
    
    const nextBellElement = document.getElementById('nextBellTime');
    if (nextBell) {
        nextBellElement.innerHTML = `<span class="next-bell">${nextBell.day} at ${formatTime(nextBell.time)}</span>`;
    } else {
        nextBellElement.innerHTML = '<span class="next-bell">No schedule configured</span>';
    }
}

function updateLastBellTime() {
    const now = new Date();
    AppState.lastBellTimestamp = now;
    
    const timeString = now.toLocaleTimeString('en-US', {
        hour12: true,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    });
    
    document.getElementById('lastBellTime').textContent = timeString;
}

function updateCurrentTime() {
    const now = new Date();
    const timeString = now.toLocaleTimeString('en-US', {
        hour12: true,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    });
    
    const timeElement = document.getElementById('currentTime');
    if (timeElement) {
        timeElement.textContent = timeString;
    }
}

function updateSystemStatus(component, status) {
    AppState.systemStatus[component] = status;
    
    switch (component) {
        case 'wifi':
            document.getElementById('wifiStatus').innerHTML = 
                `<span class="status-badge ${status === 'connected' ? 'connected' : 'disconnected'}">${status}</span>`;
            break;
        case 'mqtt':
            document.getElementById('mqttStatus').innerHTML = 
                `<span class="status-badge ${status === 'connected' ? 'connected' : 'disconnected'}">${status}</span>`;
            document.getElementById('connectionStatus').textContent = 
                status === 'connected' ? 'System Online' : 'System Offline';
            break;
    }
}

function updateModeDisplay() {
    const modeDescription = document.getElementById('modeDescription');
    const modeTabs = document.querySelectorAll('.mode-tab');
    
    if (AppState.isExamMode) {
        modeDescription.textContent = 'Exam day schedule configuration';
        modeTabs.forEach(tab => {
            tab.classList.toggle('active', tab.dataset.mode === 'exam');
        });
    } else {
        modeDescription.textContent = 'Regular school day schedule configuration';
        modeTabs.forEach(tab => {
            tab.classList.toggle('active', tab.dataset.mode === 'regular');
        });
    }
}

function initializeUI() {
    // Set initial time
    updateCurrentTime();
    
    // Update mode display
    updateModeDisplay();
    
    // Initialize tooltips
    initializeTooltips();
}

function startSystemTimers() {
    // Update time every second
    setInterval(updateCurrentTime, 1000);
    
    // Refresh schedule every 30 seconds
    setInterval(() => {
        if (AppState.user) {
            calculateNextBell();
        }
    }, 30000);
    
    // Check system health every minute
    setInterval(checkSystemHealth, 60000);
}

function checkSystemHealth() {
    const now = new Date();
    const lastSync = AppState.systemStatus.lastSync;
    
    if (lastSync && (now - new Date(lastSync)) > 300000) { // 5 minutes
        showSystemNotification('Sync Warning', 'Schedule sync is outdated', 'warning');
    }
}

function formatTime(timeString) {
    if (!timeString) return '';
    
    const [hours, minutes] = timeString.split(':');
    const hour = parseInt(hours);
    const period = hour >= 12 ? 'PM' : 'AM';
    const displayHour = hour % 12 || 12;
    
    return `${displayHour}:${minutes} ${period}`;
}

function showSystemNotification(title, message, type = 'info') {
    const notificationContainer = document.getElementById('notificationContainer');
    
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.innerHTML = `
        <i class="fas fa-${getNotificationIcon(type)}"></i>
        <div class="notification-content">
            <strong>${title}</strong>
            <p>${message}</p>
        </div>
    `;
    
    notificationContainer.appendChild(notification);
    
    // Auto-remove after 5 seconds
    setTimeout(() => {
        notification.style.animation = 'notificationSlideOut 0.3s ease';
        setTimeout(() => {
            notification.remove();
        }, 300);
    }, 5000);
}

function getNotificationIcon(type) {
    switch (type) {
        case 'success': return 'check-circle';
        case 'error': return 'exclamation-circle';
        case 'warning': return 'exclamation-triangle';
        default: return 'info-circle';
    }
}

function initializeTooltips() {
    // Add CSS for tooltips
    const tooltipCSS = `
        .tooltip {
            position: relative;
            display: inline-block;
        }
        .tooltip .tooltiptext {
            visibility: hidden;
            width: 200px;
            background-color: var(--dark-gray);
            color: var(--white);
            text-align: center;
            border-radius: var(--radius-sm);
            padding: 0.5rem;
            position: absolute;
            z-index: 1;
            bottom: 125%;
            left: 50%;
            transform: translateX(-50%);
            opacity: 0;
            transition: opacity 0.3s;
            font-size: 0.875rem;
        }
        .tooltip:hover .tooltiptext {
            visibility: visible;
            opacity: 1;
        }
    `;
    
    const style = document.createElement('style');
    style.textContent = tooltipCSS;
    document.head.appendChild(style);
}

// Global functions exposed for HTML event handlers
window.toggleDayExpansion = toggleDayExpansion;
window.toggleDayState = toggleDayState;
window.openAddPeriodModal = openAddPeriodModal;
window.deletePeriodFromDay = deletePeriodFromDay;

// Export for debugging
window.AppState = AppState;
window.CONFIG = CONFIG;

console.log('Smart Bell System Pro - All systems ready');