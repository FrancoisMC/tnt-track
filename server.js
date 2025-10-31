// Application Express
const express = require("express");
const sql = require("mssql");
require("dotenv").config();

const app = express();
const port = 3000;

//TNT Credentials
const tntUsername = process.env.TNT_USERNAME;
const tntPassword = process.env.TNT_PASSWORD;
const tntURL = process.env.TNT_URL;

// SQL Server Configuration
const sqlConfig = {
  user: process.env.SQL_USER,
  password: process.env.SQL_PASSWORD,
  database: process.env.SQL_DATABASE,
  server: process.env.SQL_SERVER,
  port: parseInt(process.env.SQL_PORT, 10),
  options: {
    encrypt: true,
    trustServerCertificate: true,
  },
};

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

// Function to get tracking numbers from SQL Server
async function getTrackingNumbers() {
  try {
    await sql.connect(sqlConfig);
    const result = await sql.query`
      SELECT [PREPARATION].[PreparationID],[PREPARATION].[LineID],[PREPARATION].[TicketsID],[PREPARATION].[SwapId],[PREPARATION].[ContractID],
      [PREPARATION].[Carrier],[PREPARATION].[TrackingNumber],[PREPARATION].[DateSend],[ADDRESS_DELIVERY].[ZipCode],[ADDRESS_DELIVERY].[City] FROM [IRIS].[dbo].[PREPARATION] 
      INNER JOIN [ADDRESS_DELIVERY] ON [ADDRESS_DELIVERY].[AddresseDeliveryID] = [PREPARATION].[AddresseDeliveryID]
      WHERE [Carrier]='TNT' AND [Status]=3 AND [Source] IN (2,6) AND [TrackingNumber]!='' ORDER BY PreparationID DESC
    `;
    return result.recordset;
  } catch (err) {
    console.error("SQL Server Error:", err);
    throw err;
  }
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
    //console.log("TNT API Response:", JSON.stringify(data, null, 2));
    return data;
  } catch (error) {
    console.error("Error calling TNT API:", error);
    throw error;
  }
}

// Function to parse YYYYMMDD format to Date object
function parseYYYYMMDD(dateString) {
  if (!dateString) return null;
  const year = dateString.substring(0, 4);
  const month = dateString.substring(4, 6);
  const day = dateString.substring(6, 8);
  return new Date(`${year}-${month}-${day}`);
}

// Function to update or insert shipment status
async function updateShipmentStatus(preparation, tntResponse, error = null) {
  try {
    await sql.connect(sqlConfig);
    const request = new sql.Request();

    // Check if record exists
    const checkResult = await request
      .input("trackingNumber", sql.VarChar, preparation.TrackingNumber)
      .query(
        "SELECT ShipmentID FROM SHIPMENT_STATUS WHERE TrackingNumber = @trackingNumber"
      );

    let query = "";
    if (error || !tntResponse.TrackResponse.consignment) {
      // Handle error case
      const errorMessage = error
        ? `${error.code}: ${error.message}`
        : "No consignment data found";

      query =
        checkResult.recordset.length > 0
          ? `
          UPDATE SHIPMENT_STATUS 
          SET 
            DateDelivery = NULL,
            StatusDelivery = @statusDelivery,
            JSON = @jsonResponse,
            Status = 9,
            DateSend = @dateSend,
            LastUpdate = GETDATE()
          WHERE TrackingNumber = @trackingNumber
        `
          : `
          INSERT INTO SHIPMENT_STATUS 
          (TrackingNumber, PreparationID, ContractID, LineID, TicketsID, SwapId, Carrier,
           DateDelivery, StatusDelivery, JSON, Status, DateSend, LastUpdate)
          VALUES 
          (@trackingNumber, @preparationId, @contractId, @lineId, @ticketsId, @swapId, @carrier,
           NULL, @statusDelivery, @jsonResponse, 9, @dateSend, GETDATE())
        `;

      await request
        .input("statusDelivery", sql.NVarChar, errorMessage)
        .input("jsonResponse", sql.NVarChar, JSON.stringify(tntResponse))
        .input("preparationId", sql.Int, preparation.PreparationID)
        .input("contractId", sql.Int, preparation.ContractID)
        .input("lineId", sql.Int, preparation.LineID)
        .input("ticketsId", sql.Int, preparation.TicketsID)
        .input("swapId", sql.Int, preparation.SwapId)
        .input("carrier", sql.VarChar, preparation.Carrier)
        .input("dateSend", sql.DateTime, preparation.DateSend)
        .query(query);
    } else {
      // Handle successful response
      const consignment = tntResponse.TrackResponse.consignment[0];
      let isDelivered = false;
      let status = 0;
      let statusDescription = consignment.statusData[0].statusDescription;
      let deliveryDate = null;

      // Handle different summary codes
      switch (consignment.summaryCode) {
        case "DEL":
          isDelivered = true;
          status = 2;
          deliveryDate = parseYYYYMMDD(consignment.deliveryDate.value);
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
          statusDescription = `${consignment.statusData[0].statusCode}:${consignment.statusData[0].statusDescription}`;
          break;
        default:
          status = 0;
      }

      query =
        checkResult.recordset.length > 0
          ? `
          UPDATE SHIPMENT_STATUS 
          SET 
            DateDelivery = ${isDelivered ? "@deliveryDate" : "NULL"},
            StatusDelivery = @statusDelivery,
            JSON = @jsonResponse,
            Status = @status,
            DateSend = @dateSend,
            LastUpdate = GETDATE()
          WHERE TrackingNumber = @trackingNumber
        `
          : `
          INSERT INTO SHIPMENT_STATUS 
          (TrackingNumber, PreparationID, ContractID, LineID, TicketsID, SwapId, Carrier,
           DateDelivery, StatusDelivery, JSON, Status, DateSend, LastUpdate)
          VALUES 
          (@trackingNumber, @preparationId, @contractId, @lineId, @ticketsId, @swapId, @carrier,
           ${
             isDelivered ? "@deliveryDate" : "NULL"
           }, @statusDelivery, @jsonResponse, @status, @dateSend, GETDATE())
        `;

      await request
        .input("deliveryDate", sql.DateTime, deliveryDate)
        .input("statusDelivery", sql.NVarChar, statusDescription)
        .input("jsonResponse", sql.NVarChar, JSON.stringify(tntResponse))
        .input("status", sql.Int, status)
        .input("preparationId", sql.Int, preparation.PreparationID)
        .input("contractId", sql.Int, preparation.ContractID)
        .input("lineId", sql.Int, preparation.LineID)
        .input("ticketsId", sql.Int, preparation.TicketsID)
        .input("swapId", sql.Int, preparation.SwapId)
        .input("carrier", sql.VarChar, preparation.Carrier)
        .input("dateSend", sql.DateTime, preparation.DateSend)
        .query(query);
    }
  } catch (err) {
    console.error("Error updating shipment status:", err);
    throw err;
  }
}

// Protected update route
app.get("/update", checkApiKey, async (req, res) => {
  const startTime = Date.now(); // Start time measurement
  let totalShipments = 0; // Initialize shipment counter

  try {
    const trackingNumbers = await getTrackingNumbers();
    const results = [];
    totalShipments = trackingNumbers.length; // Store total shipments to process

    for (const preparation of trackingNumbers) {
      try {
        const tntResult = await callTNTApi(preparation.TrackingNumber);

        // Update shipment status
        if (tntResult.TrackResponse.error) {
          await updateShipmentStatus(
            preparation,
            tntResult,
            tntResult.TrackResponse.error
          );
        } else {
          await updateShipmentStatus(preparation, tntResult);
        }

        // Format the date
        const formattedDate = preparation.DateSend
          ? new Date(preparation.DateSend)
              .toISOString()
              .slice(0, 10)
              .replace(/-/g, "")
          : "";

        results.push({
          preparationId: preparation.PreparationID,
          contractId: preparation.ContractID,
          lineId: preparation.LineID,
          ticketsId: preparation.TicketsID,
          swapId: preparation.SwapId,
          carrier: preparation.Carrier,
          dateSend: formattedDate,
          zipCode: preparation.ZipCode,
          city: preparation.City,
          trackingNumber: preparation.TrackingNumber,
          tntResponse: tntResult,
        });
      } catch (error) {
        // Format the date in the error case as well
        const formattedDate = preparation.DateSend
          ? new Date(preparation.DateSend)
              .toISOString()
              .slice(0, 10)
              .replace(/-/g, "")
          : "";

        // Update shipment status with error
        await updateShipmentStatus(
          preparation,
          {
            error: {
              code: "API_ERROR",
              message: error.message,
            },
          },
          true
        );

        results.push({
          preparationId: preparation.PreparationID,
          contractId: preparation.ContractID,
          lineId: preparation.LineID,
          ticketsId: preparation.TicketsID,
          swapId: preparation.SwapId,
          carrier: preparation.Carrier,
          dateSend: formattedDate,
          zipCode: preparation.ZipCode,
          city: preparation.City,
          trackingNumber: preparation.TrackingNumber,
          error: error.message,
        });
      }
    }

    // Calculate execution time
    const executionTime = (Date.now() - startTime) / 1000; // Convert to seconds

    // Add execution stats to the response
    res.json({
      stats: {
        executionTime: `${executionTime.toFixed(2)} seconds`,
        totalShipments: totalShipments,
      },
      results: results,
    });
  } catch (error) {
    const executionTime = (Date.now() - startTime) / 1000;
    res.status(500).json({
      error: error.message,
      stats: {
        executionTime: `${executionTime.toFixed(2)} seconds`,
        totalShipments: totalShipments,
      },
    });
  }
});

// Single tracking route
app.get("/track/:consignmentNumber", async (req, res) => {
  try {
    const result = await callTNTApi(req.params.consignmentNumber);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Lancer le serveur
app.listen(port, () => {
  console.log(`Serveur NodeJS lancé sur http://localhost:${port}`);
});
