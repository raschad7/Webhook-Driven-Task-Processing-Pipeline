import express from 'express';

const app = express();
app.use(express.json()); // This allows your app to read JSON payloads

const PORT = process.env.PORT || 3000;

app.get('/health', (req, res) => {
    res.status(200).json({ status: 'API is running smoothly' });
});

app.listen(PORT, () => {
    console.log(`Server is listening on port ${PORT}`);
});
