import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '10mb' }));

  // Helper to initialize Gemini safely
  function getGeminiClient(): GoogleGenAI | null {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return null;
    }
    return new GoogleGenAI({ apiKey });
  }

  // Health check
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', time: new Date().toISOString() });
  });

  // 1. AI Scope to Quotation Items Generator
  app.post('/api/ai/generate-scope', async (req, res) => {
    try {
      const { propertyType, unitType, condition, areaSqft, requirements, style } = req.body;

      const ai = getGeminiClient();
      if (!ai) {
        return res.status(503).json({
          error: 'Gemini API key is not configured. Please add GEMINI_API_KEY in settings or environment.',
        });
      }

      const prompt = `You are a veteran Singapore/Asian Interior Design Quantity Surveyor and Project Director.
Create a structured itemized renovation quotation breakdown for a client project.

PROJECT DETAILS:
- Property Type: ${propertyType || 'HDB'} (${unitType || '4-Room'})
- Condition: ${condition || 'BTO (New Handover)'}
- Estimated Floor Area: ${areaSqft || 1000} sqft
- Interior Design Theme: ${style || 'Modern Japandi / Contemporary'}
- Specific Client Requirements: ${requirements || 'Full house renovation with custom carpentry, wet works, false ceiling, and painting'}

Generate an exhaustive, realistic trade breakdown with Singapore market rates in SGD.
Return ONLY valid JSON with this exact schema (no markdown wrap, pure JSON):
{
  "projectTitle": "string",
  "recommendedSummary": "string",
  "categories": [
    {
      "id": "demolition | masonry | carpentry | electrical | plumbing | ceiling | painting | glass_aluminium | doors_windows | misc_prelim",
      "name": "string (e.g. Demolition & Hacking Works)",
      "items": [
        {
          "code": "string (e.g. DEM-01)",
          "description": "detailed trade specification mentioning materials, brands (e.g. Blum, Nippon, E0 plywood, Caesarstone/Quartz)",
          "room": "string (e.g. Whole House, Living Room, Master Bedroom, Kitchen, Common Bath)",
          "quantity": number,
          "unit": "ft" | "sqft" | "ls" | "nos" | "set" | "m" | "lot",
          "costPrice": number (contractor sub-con cost in SGD),
          "unitPrice": number (client selling price in SGD with ~25-35% margin),
          "isOptional": boolean,
          "isFOC": boolean,
          "notes": "string"
        }
      ]
    }
  ]
}

Include all relevant trades:
1. Demolition & Hacking (if Resale or requested)
2. Masonry & Wet Works (screeding, tiling, waterproofing, kerbs, cabinet bases)
3. Carpentry Works (kitchen top/bottom cabinets pfr, quartz/sintered stone top, master wardrobe, vanity, shoe cabinet, TV console/feature wall)
4. Electrical Works (lighting points, 13A socket points, aircon isolator, cooker point, DB replacement)
5. Plumbing & Sanitary (stainless steel piping, basin/tap install, heater, WC pans)
6. Ceiling & Partition (false ceiling, L-box with LED pelmet, curtain pelmet)
7. Painting Works (whole house Nippon 3+1 coats, sealer, door frames)
8. Glass & Aluminium (shower screens 10mm tempered, sliding doors)
9. Miscellaneous, Floor Protection & Cleaning (corrugated sheet protection, acid/chemical wash, warranty, project management)

Keep descriptions professional, precise and trade-standard.`;

      const response = await ai.models.generateContent({
        model: 'gemini-3.7-flash',
        contents: prompt,
        config: {
          responseMimeType: 'application/json',
        },
      });

      const text = response.text || '{}';
      const parsed = JSON.parse(text);
      return res.json(parsed);
    } catch (err: any) {
      console.error('Error generating AI scope:', err);
      return res.status(500).json({ error: err.message || 'Failed to generate quotation scope' });
    }
  });

  // 2. AI Spec Writer / Enhancer
  app.post('/api/ai/enhance-spec', async (req, res) => {
    try {
      const { description, trade, category } = req.body;
      const ai = getGeminiClient();
      if (!ai) {
        return res.status(503).json({ error: 'Gemini API key is not configured.' });
      }

      const prompt = `You are a professional Interior Design estimator and contract drafter.
Rewrite this rough quotation line item into a formal, legally clear, and premium contractor trade specification.
Trade Category: ${category || trade || 'General Carpentry/Masonry'}
Rough Item: "${description}"

Include standard engineering specs like:
- Material grades (e.g., E0/E1 high-density moisture-resistant plywood, anti-fingerprint laminates, 10mm tempered safety glass, Class 1 fire-rated, Blum soft-close fittings).
- Scope boundaries (e.g., supply, deliver, fabricate & install, dismantle existing).
- Exclusion/inclusions (e.g., plumbing accessories supply by owner, contractor testing & commissioning).

Return ONLY valid JSON:
{
  "enhancedDescription": "string (the professional trade spec)",
  "recommendedUnit": "ft" | "sqft" | "ls" | "nos" | "set" | "m" | "lot",
  "typicalUnitPrice": number,
  "keySellingPoints": ["point 1", "point 2"]
}`;

      const response = await ai.models.generateContent({
        model: 'gemini-3.7-flash',
        contents: prompt,
        config: {
          responseMimeType: 'application/json',
        },
      });

      const text = response.text || '{}';
      const parsed = JSON.parse(text);
      return res.json(parsed);
    } catch (err: any) {
      console.error('Error enhancing spec:', err);
      return res.status(500).json({ error: err.message || 'Failed to enhance trade specification' });
    }
  });

  // 3. AI Value Engineering & Cost Optimizer
  app.post('/api/ai/value-engineering', async (req, res) => {
    try {
      const { projectData, targetSavingsPercent } = req.body;
      const ai = getGeminiClient();
      if (!ai) {
        return res.status(503).json({ error: 'Gemini API key is not configured.' });
      }

      const prompt = `You are a seasoned Interior Design Construction Director.
Analyze this quotation data and recommend smart Value Engineering (VE) optimizations to save ~${targetSavingsPercent || 15}% without ruining aesthetics.

Project Summary:
Housing Type: ${projectData.propertyType || 'HDB'}
Total Client Price: $${projectData.totalAmount || 0}
Total Items: ${projectData.itemsCount || 0}
Line Items Sample: ${JSON.stringify((projectData.items || []).slice(0, 30))}

Provide 4 actionable Value Engineering alternatives (e.g. Sintered Stone to Premium Compact Quartz, Full tiling to Vinyl + Accent tile, Recessed cove to Magnetic track / surface spotlights, Fluted panel to textured laminate).

Return ONLY valid JSON:
{
  "overallVerdict": "string",
  "estimatedPotentialSavings": number,
  "recommendations": [
    {
      "category": "string",
      "originalScope": "string",
      "suggestedAlternative": "string",
      "estimatedSavings": number,
      "aestheticImpact": "Low" | "Medium" | "Minimal",
      "prosAndCons": "string"
    }
  ]
}`;

      const response = await ai.models.generateContent({
        model: 'gemini-3.7-flash',
        contents: prompt,
        config: {
          responseMimeType: 'application/json',
        },
      });

      const text = response.text || '{}';
      const parsed = JSON.parse(text);
      return res.json(parsed);
    } catch (err: any) {
      console.error('Error analyzing quotation:', err);
      return res.status(500).json({ error: err.message || 'Failed to analyze quotation' });
    }
  });

  // Vite middleware in dev or static files in production
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Interior Design Quotation Server running on http://localhost:${PORT}`);
  });
}

startServer();
