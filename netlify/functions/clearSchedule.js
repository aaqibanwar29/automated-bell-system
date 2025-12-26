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

    try {
        const db = await connectMongoDB();
        const collection = db.collection('schedules');

        // Delete all schedules for this user
        const result = await collection.deleteMany({ userId: userId });

        return {
            statusCode: 200,
            body: JSON.stringify({
                success: true,
                message: 'All schedules cleared',
                deletedCount: result.deletedCount
            })
        };

    } catch (error) {
        console.error('Error clearing schedule:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: error.message })
        };
    }
};