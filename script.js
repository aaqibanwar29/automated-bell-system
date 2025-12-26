// Configuration
const CONFIG = {
    MQTT_BROKER: 'your-instance.hivemq.cloud',
    MQTT_PORT: 8883,
    MQTT_TOPICS: {
        SCHEDULE_UPDATE: 'bell/schedule/update',
        RING_NOW: 'bell/ring/now',
        STATUS: 'bell/status'
    },
    API_URL: '/.netlify/functions'
};

// Global Variables
let mqttClient = null;
let schedule = [];
let user = null;
let daysSchedule = {
    "Monday": { enabled: false, periods: [] },
    "Tuesday": { enabled: false, periods: [] },
    "Wednesday": { enabled: false, periods: [] },
    "Thursday": { enabled: false, periods: [] },
    "Friday": { enabled: false, periods: [] },
    "Saturday": { enabled: false, periods: [] },
    "Sunday": { enabled: false, periods: [] },
    "Exam Day": { enabled: false, periods: [] }
};
let isExamMode = false;
let expandedDay = null;

// Initialize the application
document.addEventListener('DOMContentLoaded', function () {
    initNetlifyIdentity();
    setupEventListeners();
    updateCurrentTime();
    setInterval(updateCurrentTime, 1000);
});

// Netlify Identity Setup
function initNetlifyIdentity() {
    if (window.netlifyIdentity) {
        window.netlifyIdentity.on('init', user => {
            if (user) {
                handleLogin(user);
            }
        });

        window.netlifyIdentity.on('login', handleLogin);
        window.netlifyIdentity.on('logout', handleLogout);
    }

    // Check if user is already logged in
    const currentUser = netlifyIdentity.currentUser();
    if (currentUser) {
        handleLogin(currentUser);
    }
}

function handleLogin(userData) {
    user = userData;
    document.getElementById('loginScreen').style.display = 'none';
    document.getElementById('dashboard').style.display = 'block';
    connectToMQTT();
    loadSchedule();
}

function handleLogout() {
    user = null;
    document.getElementById('loginScreen').style.display = 'block';
    document.getElementById('dashboard').style.display = 'none';
    if (mqttClient && mqttClient.connected) {
        mqttClient.end();
    }
}

// Event Listeners
function setupEventListeners() {
    // Login Button
    document.getElementById('googleLogin')?.addEventListener('click', () => {
        netlifyIdentity.open('login');
    });

    // Logout Button
    document.getElementById('logoutBtn')?.addEventListener('click', () => {
        netlifyIdentity.logout();
    });

    // Add Period Button
    document.getElementById('addPeriodBtn')?.addEventListener('click', () => {
        document.getElementById('addPeriodModal').style.display = 'flex';
    });

    // Ring Now Button
    document.getElementById('ringNowBtn')?.addEventListener('click', ringBellNow);

    // Modal Close Buttons
    document.querySelectorAll('.close, .cancel-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.getElementById('addPeriodModal').style.display = 'none';
            document.getElementById('periodForm').reset();
        });
    });

    // Period Form Submission
    document.getElementById('periodForm')?.addEventListener('submit', savePeriod);

    // Close modal when clicking outside
    window.addEventListener('click', (e) => {
        const modal = document.getElementById('addPeriodModal');
        if (e.target === modal) {
            modal.style.display = 'none';
            document.getElementById('periodForm').reset();
        }
    });

    // Mode selector
    document.querySelectorAll('input[name="scheduleMode"]').forEach(radio => {
        radio.addEventListener('change', async (e) => {
            if (e.target.value === 'exam') {
                isExamMode = true;
                await toggleDay('Exam Day', true);
            } else {
                isExamMode = false;
                await toggleDay('Exam Day', false);
            }
        });
    });

    // Toggle all days
    document.getElementById('toggleAllBtn')?.addEventListener('click', async () => {
        const allEnabled = Object.keys(daysSchedule).every(day => daysSchedule[day].enabled);

        Object.keys(daysSchedule).forEach(async (dayName) => {
            if (dayName !== 'Exam Day') {
                await toggleDay(dayName, !allEnabled);
            }
        });
    });

    // Clear all periods
    document.getElementById('clearAllBtn')?.addEventListener('click', async () => {
        if (confirm('Are you sure you want to clear all periods?')) {
            Object.keys(daysSchedule).forEach(dayName => {
                daysSchedule[dayName].periods = [];
                updateDayCard(dayName);
            });
            await clearDatabaseAndUpdateSchedule();
            showNotification('All periods cleared', 'success');
        }
    });
}

// MQTT Connection
function connectToMQTT() {
    // For production, use a proper MQTT library with WebSocket support
    // This is a simplified version - in real implementation, use Paho MQTT or similar

    console.log('Connecting to MQTT broker...');
    updateConnectionStatus('connecting');

    // Simulated connection - replace with actual MQTT implementation
    setTimeout(() => {
        updateConnectionStatus('connected');
        simulateMQTTConnection();
    }, 1000);
}

function simulateMQTTConnection() {
    // This simulates MQTT messages - replace with actual MQTT client
    setInterval(() => {
        // Simulate status updates
        const statuses = ['online', 'offline', 'bell_rang'];
        const randomStatus = statuses[Math.floor(Math.random() * statuses.length)];

        if (randomStatus === 'bell_rang') {
            updateLastBellTime();
        }

        updateMQTTStatus(randomStatus);
    }, 10000);
}

// Schedule Management
// Load schedule from database
async function loadSchedule() {
    try {
        const response = await fetch(`${CONFIG.API_URL}/getSchedule`);
        const result = await response.json();

        if (result.schedule && result.schedule.periods) {
            // Reset days schedule
            Object.keys(daysSchedule).forEach(dayName => {
                daysSchedule[dayName].periods = [];
                daysSchedule[dayName].enabled = false;
            });

            // Group periods by day
            result.schedule.periods.forEach(period => {
                if (daysSchedule[period.day]) {
                    daysSchedule[period.day].periods.push(period);
                    daysSchedule[period.day].enabled = true;
                }
            });

            // Check if in exam mode
            isExamMode = result.schedule.periods.some(p => p.day === 'Exam Day');

            // Initialize UI
            initializeDays();
            updatePeriodsCount();
            calculateNextBell();
        }

    } catch (error) {
        console.error('Error loading schedule:', error);
        // Initialize with empty days
        initializeDays();
    }
}

function renderSchedule() {
    const scheduleList = document.getElementById('scheduleList');
    scheduleList.innerHTML = '';

    schedule.forEach((period, index) => {
        const periodElement = document.createElement('div');
        periodElement.className = 'schedule-item';
        periodElement.innerHTML = `
            <div class="schedule-info">
                <h3>${period.name || `Period ${index + 1}`}</h3>
                <div class="schedule-time">
                    <i class="far fa-clock"></i> ${period.startTime} - ${period.endTime}
                    <span class="duration">(${period.duration}s bell)</span>
                </div>
            </div>
            <div class="schedule-actions">
                <button class="btn edit-btn" onclick="editPeriod(${index})">
                    <i class="fas fa-edit"></i>
                </button>
                <button class="btn delete-btn" onclick="deletePeriod(${index})">
                    <i class="fas fa-trash"></i>
                </button>
            </div>
        `;
        scheduleList.appendChild(periodElement);
    });
}

async function savePeriod(e) {
    e.preventDefault();

    const dayName = document.getElementById('periodDay').value;
    const period = {
        name: document.getElementById('periodName').value,
        day: dayName,
        startTime: document.getElementById('startTime').value,
        endTime: document.getElementById('endTime').value,
        duration: parseInt(document.getElementById('bellDuration').value)
    };

    // Validate time
    if (period.startTime >= period.endTime) {
        showNotification('End time must be after start time', 'error');
        return;
    }

    // Add period to the day
    daysSchedule[dayName].periods.push(period);

    // Update the day card
    updateDayCard(dayName);

    // Save to database
    if (daysSchedule[dayName].enabled) {
        await updateScheduleInDatabase();
    }

    // Close modal and reset form
    document.getElementById('addPeriodModal').style.display = 'none';
    document.getElementById('periodForm').reset();

    showNotification('Period saved successfully!', 'success');
}

async function sendScheduleToESP32() {
    try {
        const periods = getAllEnabledPeriods();

        const response = await fetch(`${CONFIG.API_URL}/scheduleQueue`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${user.token.access_token}`
            },
            body: JSON.stringify({
                periods: periods,
                timestamp: new Date().toISOString(),
                type: 'full_schedule_update'
            })
        });

        if (response.status === 401 || response.status === 403) {
            showNotification('Session expired. Please log in again.', 'error');
            netlifyIdentity.logout();
            return;
        }

        if (!response.ok) {
            throw new Error('Failed to send schedule');
        }

        const result = await response.json();
        console.log('✅ Schedule sent and stored:', result);
        showNotification(`Schedule sent (${periods.length} periods)`, 'success');

    } catch (error) {
        console.error('Error sending schedule:', error);
        showNotification('Failed to send schedule', 'error');
    }
}

async function forceScheduleSync() {
    try {
        const response = await fetch(`${CONFIG.API_URL}/getSchedule`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${user.token.access_token}`
            }
        });

        const result = await response.json();

        if (!response.ok) throw new Error(result.error || 'Failed to sync schedule');

        console.log('✅ Schedule synced from server:', result);
        showNotification(`Schedule synced (${result.count} periods)`, 'success');

    } catch (error) {
        console.error('Error syncing schedule:', error);
        showNotification('Failed to sync schedule', 'error');
    }
}

async function ringBellNow() {
    const duration = parseInt(document.getElementById('manualDuration').value);

    try {
        const response = await fetch(`${CONFIG.API_URL}/ringNow`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${user.token.access_token}`
            },
            body: JSON.stringify({ duration })
        });

        if (!response.ok) throw new Error('Failed to ring bell');

        updateLastBellTime();
        showNotification('Bell rung successfully!', 'success');
    } catch (error) {
        console.error('Error ringing bell:', error);
        showNotification('Failed to ring bell', 'error');
    }
}

// Helper Functions
function updateCurrentTime() {
    const now = new Date();
    const timeString = now.toLocaleTimeString('en-US', {
        hour12: true,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    });
    document.getElementById('currentTime').textContent = timeString;
}

function updateConnectionStatus(status) {
    const statusElement = document.getElementById('connectionStatus');
    const dotElement = document.querySelector('.status-dot');

    switch (status) {
        case 'connected':
            statusElement.textContent = 'Connected';
            dotElement.className = 'status-dot online';
            break;
        case 'connecting':
            statusElement.textContent = 'Connecting...';
            dotElement.className = 'status-dot connecting';
            break;
        case 'disconnected':
            statusElement.textContent = 'Disconnected';
            dotElement.className = 'status-dot offline';
            break;
    }
}

function updateMQTTStatus(status) {
    document.getElementById('mqttStatus').textContent = status;
}

function updateLastBellTime() {
    const now = new Date();
    const timeString = now.toLocaleTimeString('en-US', {
        hour12: true,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    });
    document.getElementById('lastBellTime').textContent = timeString;
}

// Update periods count
function updatePeriodsCount() {
    const totalPeriods = Object.keys(daysSchedule).reduce((total, dayName) => {
        return total + daysSchedule[dayName].periods.length;
    }, 0);

    document.getElementById('periodsCount').textContent = totalPeriods;
}

// Calculate next bell considering day
function calculateNextBell() {
    const now = new Date();
    const currentDay = now.toLocaleDateString('en-US', { weekday: 'long' });
    const currentTime = now.getHours() * 60 + now.getMinutes();

    let nextBell = null;

    // Check today's schedule if enabled
    if (daysSchedule[currentDay]?.enabled) {
        for (const period of daysSchedule[currentDay].periods) {
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

    // If no bell today, check next enabled day
    if (!nextBell) {
        const days = Object.keys(daysSchedule);
        const currentDayIndex = days.indexOf(currentDay);

        for (let i = 1; i <= days.length; i++) {
            const nextDayIndex = (currentDayIndex + i) % days.length;
            const nextDay = days[nextDayIndex];

            if (daysSchedule[nextDay]?.enabled && daysSchedule[nextDay].periods.length > 0) {
                const earliestPeriod = daysSchedule[nextDay].periods.reduce((earliest, period) => {
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

    if (nextBell) {
        document.getElementById('nextBellTime').textContent =
            `${nextBell.day} ${nextBell.time}`;
    } else {
        document.getElementById('nextBellTime').textContent = 'No schedule';
    }
}

function editPeriod(index) {
    const period = schedule[index];

    document.getElementById('periodName').value = period.name || '';
    document.getElementById('startTime').value = period.startTime;
    document.getElementById('endTime').value = period.endTime;
    document.getElementById('bellDuration').value = period.duration;

    // Remove the old period
    schedule.splice(index, 1);

    document.getElementById('addPeriodModal').style.display = 'flex';
}

async function deletePeriod(index) {
    if (confirm('Are you sure you want to delete this period?')) {
        const period = schedule[index];

        try {
            // First get the latest schedule to see the structure
            const getResponse = await fetch(`${CONFIG.API_URL}/getSchedule`);
            const latestSchedule = await getResponse.json();

            console.log('Latest schedule from DB:', latestSchedule);

            // Use startTime for deletion
            const response = await fetch(`${CONFIG.API_URL}/scheduleQueue`, {
                method: 'DELETE',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${user.token.access_token}`
                },
                body: JSON.stringify({
                    startTime: period.startTime
                })
            });

            if (response.ok) {
                schedule.splice(index, 1);
                localStorage.setItem('bellSchedule', JSON.stringify(schedule));
                renderSchedule();
                updatePeriodsCount();
                calculateNextBell();
                showNotification('Period deleted successfully!', 'success');
                await sendScheduleToESP32();
            } else {
                throw new Error('Delete failed');
            }

        } catch (error) {
            console.error('Error:', error);
            showNotification('Delete failed. Using startTime: ' + period.startTime, 'error');
        }
    }
}

function showNotification(message, type = 'info') {
    // Create notification element
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.textContent = message;

    // Add styles
    notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        padding: 15px 25px;
        background: ${type === 'success' ? '#4cc9f0' : '#f72585'};
        color: white;
        border-radius: 8px;
        z-index: 10000;
        animation: slideIn 0.3s ease;
    `;

    document.body.appendChild(notification);

    // Remove after 3 seconds
    setTimeout(() => {
        notification.style.animation = 'slideOut 0.3s ease';
        setTimeout(() => {
            document.body.removeChild(notification);
        }, 300);
    }, 3000);
}

// Add CSS for notifications
const style = document.createElement('style');
style.textContent = `
    @keyframes slideIn {
        from { transform: translateX(100%); opacity: 0; }
        to { transform: translateX(0); opacity: 1; }
    }
    
    @keyframes slideOut {
        from { transform: translateX(0); opacity: 1; }
        to { transform: translateX(100%); opacity: 0; }
    }
`;
document.head.appendChild(style);

// Initialize days in schedule list
function initializeDays() {
    const scheduleList = document.getElementById('scheduleList');
    scheduleList.innerHTML = '';

    Object.keys(daysSchedule).forEach(dayName => {
        const dayCard = createDayCard(dayName);
        scheduleList.appendChild(dayCard);
    });
}

// Create day card HTML
function createDayCard(dayName) {
    const day = daysSchedule[dayName];
    const periodCount = day.periods.length;

    const dayCard = document.createElement('div');
    dayCard.className = `day-card ${day.enabled ? 'active' : ''} ${isExamMode && dayName === 'Exam Day' ? 'exam-mode' : ''}`;
    dayCard.id = `day-${dayName.replace(/\s+/g, '-').toLowerCase()}`;

    dayCard.innerHTML = `
        <div class="day-header" onclick="toggleDayExpansion('${dayName}')">
            <div class="day-info">
                <i class="ri-arrow-right-s-fill day-icon"></i>
                <span class="day-title">${dayName}</span>
                <span class="period-count">${periodCount} period${periodCount !== 1 ? 's' : ''}</span>
            </div>
            <div class="day-toggle">
                <label class="toggle-switch">
                    <input type="checkbox" ${day.enabled ? 'checked' : ''} 
                           onchange="toggleDay('${dayName}', this.checked)">
                    <span class="toggle-slider"></span>
                </label>
                <button class="add-period-btn" onclick="openAddPeriodModal('${dayName}')">
                    <i class="ri-apps-2-add-fill"></i>
                </button>
            </div>
        </div>
        <div class="periods-container">
            ${renderPeriodsForDay(dayName)}
        </div>
    `;

    return dayCard;
}

// Render periods for a specific day
function renderPeriodsForDay(dayName) {
    const periods = daysSchedule[dayName].periods;
    if (periods.length === 0) {
        return '<div class="no-periods">No periods added</div>';
    }

    return periods.map((period, index) => `
        <div class="period-item" data-period-index="${index}">
            <div class="period-info">
                <h4>${period.name || `Period ${index + 1}`}</h4>
                <div class="period-time">
                    <i class="far fa-clock"></i> ${period.startTime} - ${period.endTime}
                    <span class="duration">(${period.duration}s bell)</span>
                </div>
            </div>
            <div class="period-actions">
                <button class="btn delete-period-btn" onclick="deletePeriodFromDay('${dayName}', ${index})">
                    <i class="fas fa-trash"></i>
                </button>
            </div>
        </div>
    `).join('');
}

// Toggle day expansion
function toggleDayExpansion(dayName) {
    const dayCard = document.getElementById(`day-${dayName.replace(/\s+/g, '-').toLowerCase()}`);

    if (expandedDay === dayName) {
        dayCard.classList.remove('day-expanded');
        expandedDay = null;
    } else {
        // Collapse previously expanded day
        if (expandedDay) {
            const prevDayCard = document.getElementById(`day-${expandedDay.replace(/\s+/g, '-').toLowerCase()}`);
            prevDayCard.classList.remove('day-expanded');
        }

        dayCard.classList.add('day-expanded');
        expandedDay = dayName;
    }
}

// Toggle day on/off
async function toggleDay(dayName, enabled) {
    if (isExamMode && dayName !== 'Exam Day' && enabled) {
        showNotification('Cannot enable regular days in Exam mode. Disable Exam Day first.', 'error');
        document.querySelector(`#day-${dayName.replace(/\s+/g, '-').toLowerCase()} input[type="checkbox"]`).checked = false;
        return;
    }

    if (dayName === 'Exam Day' && enabled) {
        // Enable Exam Day mode - disable all other days
        isExamMode = true;
        Object.keys(daysSchedule).forEach(day => {
            if (day !== 'Exam Day') {
                daysSchedule[day].enabled = false;
                updateDayCard(day);
            }
        });
        daysSchedule['Exam Day'].enabled = true;
        updateDayCard('Exam Day');
        await clearDatabaseAndUpdateSchedule();
    } else if (dayName === 'Exam Day' && !enabled) {
        // Disable Exam Day mode
        isExamMode = false;
        daysSchedule['Exam Day'].enabled = false;
        updateDayCard('Exam Day');
        await clearDatabaseAndUpdateSchedule();
    } else {
        // Regular day toggle
        daysSchedule[dayName].enabled = enabled;
        updateDayCard(dayName);

        if (enabled) {
            await updateScheduleInDatabase();
        } else {
            await clearDayFromDatabase(dayName);
        }
    }

    // Update mode selector
    document.querySelector('input[name="scheduleMode"][value="exam"]').checked = isExamMode;
    document.querySelector('input[name="scheduleMode"][value="regular"]').checked = !isExamMode;
}

// Open add period modal with selected day
function openAddPeriodModal(dayName) {
    document.getElementById('addPeriodModal').style.display = 'flex';
    document.getElementById('selectedDay').value = dayName;
    document.getElementById('periodDay').value = dayName;
}

async function deletePeriodFromDay(dayName, periodIndex) {
    if (confirm('Are you sure you want to delete this period?')) {
        daysSchedule[dayName].periods.splice(periodIndex, 1);
        updateDayCard(dayName);

        if (daysSchedule[dayName].enabled) {
            await updateScheduleInDatabase();
        }

        showNotification('Period deleted successfully!', 'success');
    }
}

// Update day card in UI
function updateDayCard(dayName) {
    const dayCard = document.getElementById(`day-${dayName.replace(/\s+/g, '-').toLowerCase()}`);
    const newDayCard = createDayCard(dayName);

    // Preserve expansion state
    if (dayCard.classList.contains('day-expanded')) {
        newDayCard.classList.add('day-expanded');
    }

    dayCard.replaceWith(newDayCard);
}

// Get all enabled periods
function getAllEnabledPeriods() {
    const allPeriods = [];

    Object.keys(daysSchedule).forEach(dayName => {
        if (daysSchedule[dayName].enabled && daysSchedule[dayName].periods.length > 0) {
            daysSchedule[dayName].periods.forEach(period => {
                allPeriods.push({
                    ...period,
                    day: dayName
                });
            });
        }
    });

    return allPeriods;
}

// Clear database and update schedule
async function clearDatabaseAndUpdateSchedule() {
    try {
        // Clear all schedules from database
        const clearResponse = await fetch(`${CONFIG.API_URL}/clearSchedule`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${user.token.access_token}`
            }
        });

        if (!clearResponse.ok) {
            throw new Error('Failed to clear schedule');
        }

        // Update with current schedule
        await updateScheduleInDatabase();

    } catch (error) {
        console.error('Error clearing schedule:', error);
        showNotification('Failed to update schedule', 'error');
    }
}

// Clear specific day from database
async function clearDayFromDatabase(dayName) {
    try {
        const response = await fetch(`${CONFIG.API_URL}/clearDay`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${user.token.access_token}`
            },
            body: JSON.stringify({ day: dayName })
        });

        if (!response.ok) {
            throw new Error('Failed to clear day');
        }

        showNotification(`Cleared ${dayName} from schedule`, 'success');
    } catch (error) {
        console.error('Error clearing day:', error);
    }
}

// Update schedule in database
async function updateScheduleInDatabase() {
    const periods = getAllEnabledPeriods();

    if (periods.length === 0) {
        showNotification('No enabled periods to save', 'warning');
        return;
    }

    try {
        const response = await fetch(`${CONFIG.API_URL}/scheduleQueue`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${user.token.access_token}`
            },
            body: JSON.stringify({
                periods: periods,
                timestamp: new Date().toISOString(),
                type: 'full_schedule_update',
                mode: isExamMode ? 'exam' : 'regular'
            })
        });

        if (response.status === 401 || response.status === 403) {
            showNotification('Session expired. Please log in again.', 'error');
            netlifyIdentity.logout();
            return;
        }

        if (!response.ok) {
            throw new Error('Failed to update schedule');
        }

        const result = await response.json();
        console.log('✅ Schedule updated:', result);
        showNotification(`Schedule updated (${periods.length} periods)`, 'success');

        // Send to ESP32
        await sendScheduleToESP32();

    } catch (error) {
        console.error('Error updating schedule:', error);
        showNotification('Failed to update schedule', 'error');
    }
}

