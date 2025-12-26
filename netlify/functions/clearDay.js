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

exports.handler = async function (event, context) {
    // Check authentication
    if (!context.clientContext || !context.clientContext.user) {
        return {
            statusCode: 401,
            body: JSON.stringify({ error: 'Unauthorized' })
        };
    }

    const userId = context.clientContext.user.email;
    let data;

    try {
        data = JSON.parse(event.body);
    } catch (error) {
        return {
            statusCode: 400,
            body: JSON.stringify({ error: 'Invalid JSON' })
        };
    }

    const { day } = data;
    if (!day) {
        return {
            statusCode: 400,
            body: JSON.stringify({ error: 'Day is required' })
        };
    }

    try {
        const db = await connectMongoDB();
        const collection = db.collection('schedules');

        // Get user's schedules
        const userSchedules = await collection.find({ userId: userId }).toArray();

        // Remove periods for the specified day
        let updated = false;
        for (const schedule of userSchedules) {
            const originalCount = schedule.periods.length;
            const updatedPeriods = schedule.periods.filter(p => p.day !== day);

            if (updatedPeriods.length < originalCount) {
                await collection.updateOne(
                    { _id: schedule._id },
                    { $set: { periods: updatedPeriods, updatedAt: new Date() } }
                );
                updated = true;
            }
        }

        return {
            statusCode: 200,
            body: JSON.stringify({
                success: true,
                updated: updated,
                message: `Cleared periods for ${day}`
            })
        };

    } catch (error) {
        console.error('Error clearing day:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: error.message })
        };
    }
};