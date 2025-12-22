const mqtt = require('mqtt');
import { MongoClient } from "mongodb";

const mqttOptions = {
  host: process.env.MQTT_HOST,
  port: parseInt(process.env.MQTT_PORT || '8883'),
  username: process.env.MQTT_USERNAME,
  password: process.env.MQTT_PASSWORD,
  protocol: 'mqtts'
};

// MongoDB for offline schedule storage
const mongoUri = process.env.MONGODB_URI;
let mongoClient = null;

async function getMongoClient() {
  if (!mongoClient) {
    mongoClient = new MongoClient(mongoUri);
    await mongoClient.connect();
  }
  return mongoClient;
}

// Store schedule when ESP32 is offline
async function storeSchedule(scheduleData, userId) {
  const client = await getMongoClient();
  const db = client.db('bell_system');
  const collection = db.collection('pending_schedules');
  
  const pendingSchedule = {
    schedule: scheduleData,
    userId: userId,
    createdAt: new Date(),
    delivered: false,
    deliveryAttempts: 0
  };
  
  await collection.insertOne(pendingSchedule);
  console.log('📦 Schedule stored for offline delivery');
}

// Try to deliver pending schedules
async function deliverPendingSchedules() {
  const client = await getMongoClient();
  const db = client.db('bell_system');
  const collection = db.collection('pending_schedules');
  
  // Get undelivered schedules
  const pending = await collection.find({ 
    delivered: false,
    deliveryAttempts: { $lt: 5 } // Max 5 attempts
  }).toArray();
  
  if (pending.length === 0) return { delivered: 0, failed: 0 };
  
  // Try to deliver via MQTT
  const mqttClient = mqtt.connect(mqttOptions);
  
  let delivered = 0;
  let failed = 0;
  
  await new Promise((resolve, reject) => {
    mqttClient.on('connect', async () => {
      console.log(`📦 Attempting to deliver ${pending.length} pending schedules`);
      
      for (const schedule of pending) {
        try {
          await new Promise((resolveSend, rejectSend) => {
            const message = JSON.stringify({
              type: 'schedule_update',
              schedule: schedule.schedule,
              timestamp: new Date().toISOString(),
              storedAt: schedule.createdAt,
              isPendingDelivery: true
            });
            
            mqttClient.publish('bell/schedule/update', message, { qos: 1 }, (err) => {
              if (err) {
                rejectSend(err);
              } else {
                resolveSend();
              }
            });
          });
          
          // Mark as delivered
          await collection.updateOne(
            { _id: schedule._id },
            { 
              $set: { 
                delivered: true,
                deliveredAt: new Date() 
              },
              $inc: { deliveryAttempts: 1 }
            }
          );
          delivered++;
          
        } catch (error) {
          console.error('Failed to deliver schedule:', error);
          await collection.updateOne(
            { _id: schedule._id },
            { $inc: { deliveryAttempts: 1 } }
          );
          failed++;
        }
      }
      
      mqttClient.end();
      resolve();
    });
    
    mqttClient.on('error', reject);
  });
  
  return { delivered, failed };
}

// Main handler for schedule updates
exports.handler = async function(event, context) {
  console.log('📋 Schedule queue function');
  
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
    // First try to deliver immediately via MQTT
    const mqttClient = mqtt.connect(mqttOptions);
    
    const immediateDelivery = await new Promise((resolve, reject) => {
      mqttClient.on('connect', () => {
        const message = JSON.stringify({
          type: 'schedule_update',
          schedule: scheduleData,
          timestamp: new Date().toISOString(),
          userId: userId
        });
        
        mqttClient.publish('bell/schedule/update', message, { qos: 1 }, (err) => {
          mqttClient.end();
          if (err) {
            console.log('MQTT delivery failed, storing for later:', err.message);
            resolve(false); // Store for later
          } else {
            console.log('✅ Schedule delivered immediately');
            resolve(true); // Delivered successfully
          }
        });
      });
      
      mqttClient.on('error', () => {
        mqttClient.end();
        resolve(false); // Store for later
      });
      
      // Timeout
      setTimeout(() => {
        mqttClient.end();
        resolve(false);
      }, 5000);
    });
    
    if (!immediateDelivery) {
      // Store for offline delivery
      await storeSchedule(scheduleData, userId);
      
      // Also try to deliver any other pending schedules
      const deliveryResult = await deliverPendingSchedules();
      console.log('Offline delivery attempt:', deliveryResult);
      
      return {
        statusCode: 202, // Accepted but not delivered
        body: JSON.stringify({
          success: true,
          message: 'Schedule stored for delivery when ESP32 comes online',
          stored: true,
          pendingDelivery: true,
          deliveryStats: deliveryResult
        })
      };
    }
    
    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        message: 'Schedule delivered to ESP32',
        delivered: true,
        timestamp: new Date().toISOString()
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
};