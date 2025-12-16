exports.handler = async function(event, context) {
    // This function is handled automatically by Netlify Identity
    // It's here just to show the structure
    
    return {
        statusCode: 200,
        body: JSON.stringify({ 
            message: 'Login handled by Netlify Identity',
            user: context.clientContext.user 
        })
    };
};