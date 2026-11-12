require("dotenv").config();

const express = require("express");
const path = require("path");
const multer = require("multer");

const app = express();
const PORT = process.env.PORT || 3000;

// Chuyển sang model nhẹ, ưu tiên tốc độ.
const MODEL = "gemini-3.5-flash-lite";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype && file.mimetype.startsWith("image/")) {
      cb(null, true);
    } else {
      cb(new Error("Chỉ chấp nhận ảnh."));
    }
  }
});

app.use(express.json({ limit: "20kb" }));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

let ai;

async function generateWithRetry(contents) {
  if (!ai) throw new Error("Server chưa nhận được GEMINI_API_KEY.");

  for (let attempt = 1; attempt <= 2; attempt++) {
    let timer;

    try {
      const request = ai.models.generateContent({
        model: MODEL,
        contents
      });

      const timeout = new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("Gemini phản hồi quá lâu. Hãy thử lại.")),
          30000
        );
      });

      const result = await Promise.race([request, timeout]);
      return result.text || "Mình chưa tạo được câu trả lời. Bạn thử lại nhé!";
    } catch (error) {
      console.error(`Gemini lỗi lần ${attempt}:`, error.message);

      const temporary =
        /429|500|502|503|504|UNAVAILABLE|RESOURCE_EXHAUSTED/i.test(error.message);

      if (!temporary || attempt === 2) throw error;

      await new Promise(resolve => setTimeout(resolve, 1500));
    } finally {
      clearTimeout(timer);
    }
  }
}

app.get("/api/health", (req, res) => {
  res.json({ status: "ok", app: "HORMONY AI" });
});

app.post("/api/ask", upload.single("image"), async (req, res) => {
  try {
    const question = (req.body.question || "").trim();
    const imageFile = req.file;

    if (!question && !imageFile) {
      return res.status(400).json({
        error: "Bạn hãy nhập câu hỏi hoặc chọn ảnh đề bài nhé!"
      });
    }

    if (question.length > 2000) {
      return res.status(400).json({
        error: "Câu hỏi tối đa 2000 ký tự."
      });
    }

    const parts = [{
      text: `Bạn là HORMONY AI, trợ lý học tập thân thiện dành cho học sinh.
Hỗ trợ Toán, Văn, Anh, Lý và các môn học khác.
Giải thích từng bước bằng tiếng Việt đơn giản, dễ hiểu.
Với Toán và Lý, nêu công thức và cách tính.
Với tiếng Anh, hỗ trợ dịch, từ vựng và ngữ pháp.
Với Ngữ văn, trình bày rõ ý và có bố cục.

Câu hỏi của học sinh:
${question || "Hãy đọc ảnh đề bài và hướng dẫn giải."}`
    }];

    if (imageFile) {
      parts.push({
        inlineData: {
          mimeType: imageFile.mimetype,
          data: imageFile.buffer.toString("base64")
        }
      });
    }

    const answer = await generateWithRetry([
      { role: "user", parts }
    ]);

    res.json({ answer });
  } catch (error) {
    console.error("Study API:", error.message);

    const status = /429|503|UNAVAILABLE|RESOURCE_EXHAUSTED/i.test(error.message)
      ? 503
      : 500;

    res.status(status).json({
      error: "AI chưa trả lời được: " + error.message
    });
  }
});

app.post("/api/english", async (req, res) => {
  try {
    const { question, level = "A2", mode = "conversation" } = req.body;

    if (!question || !question.trim()) {
      return res.status(400).json({
        error: "Bạn hãy nhập nội dung muốn học nhé!"
      });
    }

    const modes = {
      conversation: "Trò chuyện tiếng Anh, mỗi lượt đặt một câu hỏi ngắn.",
      grammar: "Sửa lỗi ngữ pháp và giải thích bằng tiếng Việt.",
      vocabulary: "Dạy 5 từ vựng, nghĩa và ví dụ đơn giản.",
      translation: "Dịch và giải thích từ vựng, cấu trúc câu."
    };

    const answer = await generateWithRetry(`
Bạn là gia sư tiếng Anh thân thiện.
Trình độ: ${level}.
Nhiệm vụ: ${modes[mode] || modes.conversation}
Giải thích đơn giản bằng tiếng Việt.

Nội dung học sinh gửi:
${question}
`);

    res.json({ answer });
  } catch (error) {
    console.error("English API:", error.message);
    res.status(503).json({
      error: "Gia sư tiếng Anh chưa trả lời được: " + error.message
    });
  }
});

app.use((error, req, res, next) => {
  console.error("Server error:", error.message);
  res.status(400).json({ error: error.message });
});

async function startServer() {
  if (process.env.GEMINI_API_KEY) {
    const { GoogleGenAI } = await import("@google/genai");
    ai = new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY
    });
  }

  app.listen(PORT, () => {
    console.log("HORMONY AI đang chạy ở cổng " + PORT);
    console.log("Model đang dùng: " + MODEL);
  });
}

startServer().catch(error => {
  console.error("Không thể khởi động:", error.message);
  process.exit(1);
});
