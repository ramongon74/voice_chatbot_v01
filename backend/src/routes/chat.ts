import { Router } from 'express';
import { GoogleGenerativeAI } from '@google/generative-ai';

export const chatRouter = Router();

chatRouter.post('/', async (req, res) => {
  // 1. Obtener la clave API desde las variables de entorno (el secreto)
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'GEMINI_API_KEY no está configurada' });
  }

  // 2. Obtener el historial del body de la petición
  const { history } = req.body;
  if (!history) {
    return res.status(400).json({ error: 'Falta el historial de chat' });
  }

  try {
    // 3. Inicializar el modelo de Gemini
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' }); // Puedes cambiar 'gemini-1.5-flash' por 'gemini-pro' si prefieres

    // 4. Separar el historial y el nuevo mensaje
    const lastMessage = history.pop(); // El último mensaje es el del usuario

    const chat = model.startChat({
      history: history, // El resto es el historial
    });

    // 5. Enviar el mensaje y devolver la respuesta como un stream
    const result = await chat.sendMessageStream(lastMessage.parts);

    res.setHeader('Content-Type', 'text/plain');
    for await (const chunk of result.stream) {
      const chunkText = chunk.text();
      res.write(chunkText); // Envía cada trozo al cliente
    }
    res.end(); // Termina la respuesta

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al contactar con la API de Gemini' });
  }
});
