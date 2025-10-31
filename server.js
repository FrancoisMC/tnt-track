// Application Express
const express = require("express");
require("dotenv").config();

const app = express();
const port = process.env.PORT || 3000;

// Middleware pour parser le JSON
app.use(express.json());

// TNT Credentials
const tntUsername = process.env.TNT_USERNAME;
const tntPassword = process.env.TNT_PASSWORD;
const tntURL = process.env.TNT_URL;

// API key configuration
const API_KEY = process.env.API_KEY;

// Middleware to check API key
function checkApiKey(req, res, next) {
  const apiKey = req.headers["x-api-key"];

  if (!apiKey) {
    return res.status(401).json({
      error: "Unauthorized",
      message: "API key is missing",
    });
  }

  if (apiKey !== API_KEY) {
    return res.status(403).json({
      error: "Forbidden",
      message: "Invalid API key",
    });
  }

  next();
}

// Function to parse YYYYMMDD format to Date object
function parseYYYYMMDD(dateString) {
  if (!dateString) return null;
  const year = dateString.substring(0, 4);
  const month = dateString.substring(4, 6);
  const day = dateString.substring(6, 8);
  return new Date(`${year}-${month}-${day}`);
}

// Function to extract summary from TNT response
function extractSummary(tntResponse) {
  // Si erreur dans la réponse
  if (tntResponse.TrackResponse?.error || !tntResponse.TrackResponse?.consignment) {
    return {
      status: 9,
      statusDescription: tntResponse.TrackResponse?.error
        ? `${tntResponse.TrackResponse.error.code}: ${tntResponse.TrackResponse.error.message}`
        : "No consignment data found",
      isDelivered: false,
      deliveryDate: null,
      summaryCode: null,
    };
  }

  const consignment = tntResponse.TrackResponse.consignment[0];
  let isDelivered = false;
  let status = 0;
  let statusDescription = consignment.statusData?.[0]?.statusDescription || "Unknown";
  let deliveryDate = null;

  // Handle different summary codes
  switch (consignment.summaryCode) {
    case "DEL":
      isDelivered = true;
      status = 2;
      deliveryDate = consignment.deliveryDate?.value
        ? parseYYYYMMDD(consignment.deliveryDate.value)
        : null;
      break;
    case "CNF":
      status = 8;
      statusDescription = "Consignement Not Found (too old)";
      break;
    case "INT":
      status = 1;
      statusDescription = "In Transit";
      break;
    case "EXC":
      status = 7;
      statusDescription = consignment.statusData?.[0]
        ? `${consignment.statusData[0].statusCode}:${consignment.statusData[0].statusDescription}`
        : "Exception";
      break;
    default:
      status = 0;
  }

  return {
    status: status,
    statusDescription: statusDescription,
    isDelivered: isDelivered,
    deliveryDate: deliveryDate,
    summaryCode: consignment.summaryCode,
  };
}

// Function to call TNT API
async function callTNTApi(consignmentNumber) {
  // Create the payload
  const payload = {
    TrackRequest: {
      searchCriteria: {
        consignmentNumber: [consignmentNumber],
        marketType: "domestic",
        originCountry: "FR",
      },
      levelOfDetail: {
        summary: {
          locale: "FR",
        },
        pod: {
          format: "URL",
        },
      },
      locale: "fr_FR",
      version: "3.1",
    },
  };

  // Create Basic Auth token
  const basicAuth = Buffer.from(`${tntUsername}:${tntPassword}`).toString(
    "base64"
  );

  try {
    const response = await fetch(tntURL, {
      method: "POST",
      headers: {
        Authorization: `Basic ${basicAuth}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    return data;
  } catch (error) {
    console.error("Error calling TNT API:", error);
    throw error;
  }
}

// Endpoint POST pour traiter une liste d'expéditions
app.post("/track", checkApiKey, async (req, res) => {
  const startTime = Date.now();

  try {
    // Vérifier que le body contient un tableau de shipments
    if (!req.body.shipments || !Array.isArray(req.body.shipments)) {
      return res.status(400).json({
        error: "Bad Request",
        message: "Le body doit contenir un champ 'shipments' avec un tableau d'expéditions",
      });
    }

    const shipments = req.body.shipments;
    const results = [];

    // Traiter chaque expédition
    for (const shipment of shipments) {
      // Vérifier les champs requis (seul trackingNumber est obligatoire)
      if (!shipment.trackingNumber) {
        results.push({
          preparationId: shipment.preparationId,
          contractId: shipment.contractId,
          lineId: shipment.lineId,
          ticketId: shipment.ticketId,
          swapId: shipment.swapId,
          trackingNumber: "N/A",
          summary: {
            status: 9,
            statusDescription: "Le champ 'trackingNumber' est obligatoire",
            isDelivered: false,
            deliveryDate: null,
            summaryCode: null,
          },
          error: "Le champ 'trackingNumber' est obligatoire",
        });
        continue;
      }

      try {
        // Appeler l'API TNT
        const tntResult = await callTNTApi(shipment.trackingNumber);

        // Extraire le résumé
        const summary = extractSummary(tntResult);

        // Préparer le résultat
        results.push({
          preparationId: shipment.preparationId,
          contractId: shipment.contractId,
          lineId: shipment.lineId,
          ticketId: shipment.ticketId,
          swapId: shipment.swapId,
          trackingNumber: shipment.trackingNumber,
          summary: summary,
          tntResponse: tntResult,
        });
      } catch (error) {
        // En cas d'erreur lors de l'appel TNT
        results.push({
          preparationId: shipment.preparationId,
          contractId: shipment.contractId,
          lineId: shipment.lineId,
          ticketId: shipment.ticketId,
          swapId: shipment.swapId,
          trackingNumber: shipment.trackingNumber,
          summary: {
            status: 9,
            statusDescription: error.message,
            isDelivered: false,
            deliveryDate: null,
            summaryCode: null,
          },
          error: error.message,
        });
      }
    }

    // Calculer le temps d'exécution
    const executionTime = (Date.now() - startTime) / 1000;

    // Retourner les résultats
    res.json({
      stats: {
        executionTime: `${executionTime.toFixed(2)} seconds`,
        totalShipments: shipments.length,
        processed: results.length,
      },
      results: results,
    });
  } catch (error) {
    const executionTime = (Date.now() - startTime) / 1000;
    res.status(500).json({
      error: error.message,
      stats: {
        executionTime: `${executionTime.toFixed(2)} seconds`,
      },
    });
  }
});

// Endpoint de santé
app.get("/health", (req, res) => {
  res.json({ status: "OK" });
});

// Lancer le serveur
app.listen(port, () => {
  console.log(`Serveur NodeJS lancé sur http://localhost:${port}`);
});

