const mqtt = require('mqtt');
const { MongoClient } = require('mongodb');

const mqttOptions = {
  host: process.env.MQTT_HOST,
  port: parseInt(process.env.MQTT_PORT || '8883'),
  username: process.env.MQTT_USERNAME,
  password: process.env.MQTT_PASSWORD,
  protocol: 'mqtts'
};

// MongoDB connection
const mongoUri = process.env.MONGODB_URI;
let mongoClient = null;
let db = null;

async function connectMongoDB() {
  if (!mongoClient) {
    mongoClient = new MongoClient(mongoUri);
    await mongoClient.connect();
    db = mongoClient.db('bell_system');
  }
  return db;
}

// Store schedule when ESP32 is offline
async function storeSchedule(scheduleData, userId) {
  const db = await connectMongoDB();
  const collection = db.collection('schedules');
  
  // Store schedule with timestamp
  const schedule = {
    periods: scheduleData.periods || [],
    userId: userId,
    updatedAt: new Date(),
    delivered: false,
    deliveryAttempts: 0
  };
  
  await collection.deleteMany({ userId: userId }); // Remove old schedules
  await collection.insertOne(schedule);
  console.log('📦 Schedule stored in MongoDB');
  return schedule;
}

// Get all schedules for a user
async function getSchedules(userId) {
  const db = await connectMongoDB();
  const collection = db.collection('schedules');
  
  const schedules = await collection.find({ userId: userId }).toArray();
  return schedules;
}

// Get all pending schedules (not delivered)
async function getPendingSchedules() {
  const db = await connectMongoDB();
  const collection = db.collection('schedules');
  
  const pending = await collection.find({ 
    delivered: false,
    deliveryAttempts: { $lt: 5 }
  }).toArray();
  
  return pending;
}

// Mark schedule as delivered
async function markAsDelivered(scheduleId) {
  const db = await connectMongoDB();
  const collection = db.collection('schedules');
  
  await collection.updateOne(
    { _id: scheduleId },
    { 
      $set: { 
        delivered: true,
        deliveredAt: new Date() 
      },
      $inc: { deliveryAttempts: 1 }
    }
  );
}

// Deliver pending schedules via MQTT
async function deliverPendingSchedules() {
  const pendingSchedules = await getPendingSchedules();
  
  if (pendingSchedules.length === 0) {
    return { delivered: 0, failed: 0 };
  }
  
  const mqttClient = mqtt.connect(mqttOptions);
  
  let delivered = 0;
  let failed = 0;
  
  await new Promise((resolve, reject) => {
    mqttClient.on('connect', async () => {
      console.log(`📦 Attempting to deliver ${pendingSchedules.length} pending schedules`);
      
      for (const schedule of pendingSchedules) {
        try {
          await new Promise((resolveSend, rejectSend) => {
            const message = JSON.stringify({
              type: 'full_schedule_update',
              schedule: {
                periods: schedule.periods
              },
              timestamp: new Date().toISOString(),
              scheduleId: schedule._id.toString()
            });
            
            mqttClient.publish('bell/schedule/update', message, { qos: 1 }, (err) => {
              if (err) {
                rejectSend(err);
              } else {
                resolveSend();
              }
            });
          });
          
          await markAsDelivered(schedule._id);
          delivered++;
          
        } catch (error) {
          console.error('Failed to deliver schedule:', error);
          failed++;
        }
      }
      
      mqttClient.end();
      resolve();
    });
    
    mqttClient.on('error', reject);
    setTimeout(() => reject(new Error('MQTT timeout')), 10000);
  });
  
  return { delivered, failed };
}

// ESP32 schedule request handler
async function handleScheduleRequest(clientId) {
  try {
    // Get all schedules (for all users, or you can filter by user)
    const db = await connectMongoDB();
    const collection = db.collection('schedules');
    
    // Get the latest schedule for each user
    const schedules = await collection.find({}).sort({ updatedAt: -1 }).toArray();
    
    if (schedules.length === 0) return null;
    
    // Combine all schedules (or you can send them separately)
    const allPeriods = [];
    schedules.forEach(schedule => {
      if (schedule.periods && Array.isArray(schedule.periods)) {
        allPeriods.push(...schedule.periods);
      }
    });
    
    return {
      schedule: {
        periods: allPeriods
      },
      count: allPeriods.length,
      timestamp: new Date().toISOString()
    };
    
  } catch (error) {
    console.error('Error handling schedule request:', error);
    return null;
  }
}

// Main handler
exports.handler = async function(event, context) {
  console.log('📋 Schedule queue function');
  
  // Handle GET request for schedule retrieval (for ESP32)
  if (event.httpMethod === 'GET') {
    try {
      const clientId = event.queryStringParameters?.clientId || 'ESP32';
      const schedule = await handleScheduleRequest(clientId);
      
      if (!schedule) {
        return {
          statusCode: 404,
          body: JSON.stringify({ 
            error: 'No schedules found',
            message: 'No schedules available in database'
          })
        };
      }
      
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(schedule)
      };
      
    } catch (error) {
      return {
        statusCode: 500,
        body: JSON.stringify({ 
          success: false, 
          error: error.message 
        })
      };
    }
  }
  
  // Handle POST request for schedule storage (from WebApp)
  if (event.httpMethod === 'POST') {
    // Check authentication
    if (!context.clientContext || !context.clientContext.user) {
      return { 
        statusCode: 401, 
        body: JSON.stringify({ error: 'Unauthorized' }) 
      };
    }
    
    const userId = context.clientContext.user.email;
    let scheduleData;
    
    try {
      scheduleData = JSON.parse(event.body);
    } catch (error) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Invalid JSON' })
      };
    }
    
    // Validate schedule
    if (!scheduleData.periods || !Array.isArray(scheduleData.periods)) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Invalid schedule format' })
      };
    }
    
    try {
      // Store schedule in MongoDB
      await storeSchedule(scheduleData, userId);
      
      // Try to deliver immediately
      const deliveryResult = await deliverPendingSchedules();
      
      return {
        statusCode: 200,
        body: JSON.stringify({
          success: true,
          message: 'Schedule stored successfully',
          stored: true,
          pendingDelivery: deliveryResult.delivered === 0,
          deliveryStats: deliveryResult,
          periodCount: scheduleData.periods.length
        })
      };
      
    } catch (error) {
      console.error('Schedule queue error:', error);
      return {
        statusCode: 500,
        body: JSON.stringify({ 
          success: false, 
          error: error.message 
        })
      };
    }
  }
  
  // Method not allowed
  return {
    statusCode: 405,
    body: JSON.stringify({ error: 'Method not allowed' })
  };
};