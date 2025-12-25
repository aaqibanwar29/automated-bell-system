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
async function loadSchedule() {
    try {
        // Load from localStorage for demo
        const savedSchedule = localStorage.getItem('bellSchedule');
        if (savedSchedule) {
            schedule = JSON.parse(savedSchedule);
            renderSchedule();
            updatePeriodsCount();
            calculateNextBell();
        }
    } catch (error) {
        console.error('Error loading schedule:', error);
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

    const period = {
        name: document.getElementById('periodName').value,
        startTime: document.getElementById('startTime').value,
        endTime: document.getElementById('endTime').value,
        duration: parseInt(document.getElementById('bellDuration').value)
    };

    schedule.push(period);

    // Save to localStorage (replace with API call in production)
    localStorage.setItem('bellSchedule', JSON.stringify(schedule));

    // Send to ESP32 via MQTT
    await sendScheduleToESP32();

    // Update UI
    renderSchedule();
    updatePeriodsCount();
    calculateNextBell();

    // Close modal and reset form
    document.getElementById('addPeriodModal').style.display = 'none';
    document.getElementById('periodForm').reset();

    showNotification('Period saved successfully!', 'success');
}

async function sendScheduleToESP32() {
    try {
        const response = await fetch(`${CONFIG.API_URL}/scheduleQueue`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${user.token.access_token}`
            },
            body: JSON.stringify({
                periods: schedule.map(period => ({
                    ...period,
                    // Ensure scheduleId is included when saving
                    scheduleId: period.scheduleId || generateUniqueId()
                })),
                timestamp: new Date().toISOString(),
                type: 'full_schedule_update'
            })
        });

        const result = await response.json();

        if (!response.ok) throw new Error(result.error || 'Failed to send schedule');

        // Store the scheduleId returned from server
        if (result.scheduleId) {
            schedule.forEach((period, index) => {
                period.scheduleId = result.scheduleId;
            });
            localStorage.setItem('bellSchedule', JSON.stringify(schedule));
        }

        console.log('✅ Schedule sent and stored:', result);
        showNotification(`Schedule sent (${schedule.length} periods)`, 'success');

    } catch (error) {
        console.error('Error sending schedule:', error);
        showNotification('Failed to send schedule to ESP32', 'error');
    }
}

// Helper function to generate unique ID
function generateUniqueId() {
    return Date.now().toString(36) + Math.random().toString(36).substring(2);
}

async function deletePeriod(index) {
    if (confirm('Are you sure you want to delete this period?')) {
        const period = schedule[index];

        // Get scheduleId from localStorage or from first period
        let scheduleId = localStorage.getItem('currentScheduleId');
        if (!scheduleId && schedule.length > 0 && schedule[0].scheduleId) {
            scheduleId = schedule[0].scheduleId;
        }

        console.log('Attempting to delete period:', {
            index: index,
            period: period,
            startTime: period.startTime,
            scheduleId: scheduleId || 'Not found'
        });

        try {
            const response = await fetch(`${CONFIG.API_URL}/scheduleQueue`, {
                method: 'DELETE',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${user.token.access_token}`
                },
                body: JSON.stringify({
                    // Send startTime as the primary identifier
                    startTime: period.startTime,
                    // Send scheduleId if we have it
                    scheduleId: scheduleId || undefined
                })
            });

            const responseText = await response.text();
            let result;
            try {
                result = JSON.parse(responseText);
            } catch (e) {
                result = { error: responseText };
            }

            if (!response.ok) {
                console.error('Delete failed with details:', result);
                throw new Error(result.error || `Server responded with ${response.status}`);
            }

            // Remove from local array
            schedule.splice(index, 1);
            localStorage.setItem('bellSchedule', JSON.stringify(schedule));

            // Update UI
            renderSchedule();
            updatePeriodsCount();
            calculateNextBell();

            showNotification('Period deleted successfully!', 'success');

            // Also send updated schedule to ESP32
            await sendScheduleToESP32();

        } catch (error) {
            console.error('Error deleting period:', error);

            let message = 'Failed to delete period from database';
            if (error.message.includes('input must be a 24 character')) {
                message = 'Database ID issue. Please refresh and try again.';
            }

            showNotification(message, 'error');
        }
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

function updatePeriodsCount() {
    document.getElementById('periodsCount').textContent = schedule.length;
}

function calculateNextBell() {
    if (schedule.length === 0) {
        document.getElementById('nextBellTime').textContent = 'No schedule';
        return;
    }

    const now = new Date();
    const currentTime = now.getHours() * 60 + now.getMinutes();

    let nextBell = null;

    for (const period of schedule) {
        const [startHour, startMinute] = period.startTime.split(':').map(Number);
        const startTime = startHour * 60 + startMinute;

        if (startTime > currentTime) {
            if (!nextBell || startTime < nextBell.startTime) {
                nextBell = {
                    time: period.startTime,
                    startTime: startTime
                };
            }
        }
    }

    if (nextBell) {
        document.getElementById('nextBellTime').textContent = nextBell.time;
    } else {
        document.getElementById('nextBellTime').textContent = 'Tomorrow';
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

        // Log what we're trying to delete for debugging
        console.log('Attempting to delete period:', {
            index: index,
            period: period,
            scheduleId: period.scheduleId,
            periodId: period.scheduleId || period._id
        });

        try {
            const response = await fetch(`${CONFIG.API_URL}/scheduleQueue`, {
                method: 'DELETE',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${user.token.access_token}`
                },
                body: JSON.stringify({
                    periodId: period.scheduleId || period._id || period.id,
                    scheduleId: period.scheduleId || 'main', // Default to 'main' if no scheduleId
                    startTime: period.startTime // Send as backup identifier
                })
            });

            // Parse response even if status is not OK to get error details
            const responseText = await response.text();
            let result;
            try {
                result = JSON.parse(responseText);
            } catch (e) {
                result = { error: responseText };
            }

            if (!response.ok) {
                console.error('Delete failed with details:', result);
                throw new Error(result.error || `Server responded with ${response.status}`);
            }

            // Remove from local array
            schedule.splice(index, 1);
            localStorage.setItem('bellSchedule', JSON.stringify(schedule));

            // Update UI
            renderSchedule();
            updatePeriodsCount();
            calculateNextBell();

            showNotification('Period deleted successfully from database!', 'success');

            // Also send updated schedule to ESP32
            await sendScheduleToESP32();

        } catch (error) {
            console.error('Error deleting period:', error);

            // Show more specific error message
            let message = 'Failed to delete period from database';
            if (error.message.includes('Period not found')) {
                message = 'Period not found in database. It may have already been deleted.';
            } else if (error.message.includes('Schedule not found')) {
                message = 'Schedule not found in database. Please refresh and try again.';
            }

            showNotification(message, 'error');
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