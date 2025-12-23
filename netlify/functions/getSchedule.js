const { MongoClient } = require('mongodb');

const mongoUri = process.env.MONGODB_URI;
let mongoClient = null;

async function connectMongoDB() {
  if (!mongoClient) {
    mongoClient = new MongoClient(mongoUri);
    await mongoClient.connect();
  }
  return mongoClient.db('bell_system');
}

exports.handler = async function(event, context) {
  console.log('📋 Get schedule function invoked');
  
  try {
    const db = await connectMongoDB();
    const collection = db.collection('schedules');
    
    // Get all schedules, sorted by most recent
    const schedules = await collection.find({})
      .sort({ updatedAt: -1 })
      .limit(10) // Limit to 10 most recent schedules
      .toArray();
    
    if (schedules.length === 0) {
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          schedule: { periods: [] },
          count: 0,
          message: 'No schedules found'
        })
      };
    }
    
    // Combine all periods from all schedules
    const allPeriods = [];
    schedules.forEach(schedule => {
      if (schedule.periods && Array.isArray(schedule.periods)) {
        schedule.periods.forEach(period => {
          // Add schedule ID to track delivery
          period.scheduleId = schedule._id.toString();
          allPeriods.push(period);
        });
      }
    });
    
    // Remove duplicates based on startTime and duration
    const uniquePeriods = [];
    const seenPeriods = new Set();
    
    allPeriods.forEach(period => {
      const key = `${period.startTime}-${period.duration}`;
      if (!seenPeriods.has(key)) {
        seenPeriods.add(key);
        uniquePeriods.push(period);
      }
    });
    
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        schedule: { periods: uniquePeriods },
        count: uniquePeriods.length,
        timestamp: new Date().toISOString(),
        totalSchedules: schedules.length
      })
    };
    
  } catch (error) {
    console.error('Error getting schedules:', error);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        error: 'Failed to get schedules',
        message: error.message 
      })
    };
  }
};