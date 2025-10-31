# TNT Track API

API REST pour suivre le statut des expéditions TNT en masse.

## 📋 Table des matières

- [Installation](#installation)
- [Configuration](#configuration)
- [Endpoints](#endpoints)
- [Format des requêtes](#format-des-requêtes)
- [Format des réponses](#format-des-réponses)
- [Docker](#docker)
- [Exemples](#exemples)

## 🚀 Installation

### Prérequis

- Node.js 20 ou supérieur
- npm ou yarn

### Installation locale

```bash
# Installer les dépendances
npm install

# Démarrer le serveur
npm start
```

Le serveur sera accessible sur `http://localhost:3000` (ou le port défini dans `PORT`).

## ⚙️ Configuration

### Variables d'environnement

Créez un fichier `.env` à la racine du projet avec les variables suivantes :

```env
# Credentials TNT
TNT_USERNAME=votre_username
TNT_PASSWORD=votre_password
TNT_URL=https://api.tnt.fr/endpoint

# Clé API pour sécuriser les endpoints
API_KEY=votre_cle_api_secrete

# Port du serveur (optionnel, défaut: 3000)
PORT=3000
```

### Variables requises

| Variable | Description | Obligatoire |
|----------|-------------|-------------|
| `TNT_USERNAME` | Nom d'utilisateur pour l'API TNT | ✅ Oui |
| `TNT_PASSWORD` | Mot de passe pour l'API TNT | ✅ Oui |
| `TNT_URL` | URL de l'endpoint TNT | ✅ Oui |
| `API_KEY` | Clé secrète pour authentifier les requêtes | ✅ Oui |
| `PORT` | Port d'écoute du serveur | ❌ Non (défaut: 3000) |

## 🔌 Endpoints

### POST /track

Endpoint principal pour suivre plusieurs expéditions en une seule requête.

**Authentification requise :** Oui (header `x-api-key`)

**Headers :**
```
Content-Type: application/json
x-api-key: votre_cle_api
```

### GET /health

Endpoint de santé pour vérifier que l'API est opérationnelle.

**Authentification requise :** Non

**Réponse :**
```json
{
  "status": "OK"
}
```

## 📨 Format des requêtes

### POST /track

Le body de la requête doit contenir un tableau d'expéditions dans le champ `shipments`.

**Champs obligatoires :**
- `trackingNumber` : Numéro de suivi TNT (string)

**Champs optionnels :**
- `preparationId` : ID de préparation (number)
- `contractId` : ID de contrat (number)
- `lineId` : ID de ligne (number)
- `ticketId` : ID de ticket (number)
- `swapId` : ID de swap (number)

**Exemple de requête :**

```json
{
  "shipments": [
    {
      "trackingNumber": "3143818594002303",
      "preparationId": 555,
      "contractId": 111,
      "lineId": 222,
      "ticketId": 333,
      "swapId": 444
    },
    {
      "trackingNumber": "ABC123",
      "preparationId": 12
    },
    {
      "trackingNumber": "XYZ789"
    }
  ]
}
```

## 📤 Format des réponses

### Réponse de succès (POST /track)

```json
{
  "stats": {
    "executionTime": "1.99 seconds",
    "totalShipments": 3,
    "processed": 3
  },
  "results": [
    {
      "preparationId": 555,
      "contractId": 111,
      "lineId": 222,
      "ticketId": 333,
      "swapId": 444,
      "trackingNumber": "3143818594002303",
      "summary": {
        "status": 2,
        "statusDescription": "Delivered",
        "isDelivered": true,
        "deliveryDate": "2024-01-15T00:00:00.000Z",
        "summaryCode": "DEL"
      },
      "tntResponse": {
        "TrackResponse": {
          "consignment": [...]
        }
      }
    }
  ]
}
```

### Structure du champ `summary`

Le champ `summary` contient un résumé structuré du statut de l'expédition :

| Champ | Type | Description |
|-------|------|-------------|
| `status` | number | Code de statut : 0 (par défaut), 1 (en transit), 2 (livré), 7 (exception), 8 (non trouvé), 9 (erreur) |
| `statusDescription` | string | Description textuelle du statut |
| `isDelivered` | boolean | `true` si l'expédition est livrée, `false` sinon |
| `deliveryDate` | Date\|null | Date de livraison au format ISO, ou `null` si non livrée |
| `summaryCode` | string\|null | Code de résumé TNT : "DEL", "CNF", "INT", "EXC", etc. |

### Codes de statut

| Code | Signification | summaryCode TNT |
|------|---------------|-----------------|
| 0 | Statut par défaut / inconnu | Autres |
| 1 | En transit | INT |
| 2 | Livré | DEL |
| 7 | Exception | EXC |
| 8 | Colis non trouvé (trop ancien) | CNF |
| 9 | Erreur lors de la requête | N/A |

### Réponse avec erreur pour une expédition

Si une expédition échoue, elle est quand même incluse dans les résultats avec un champ `error` :

```json
{
  "preparationId": 12,
  "trackingNumber": "ABC123",
  "summary": {
    "status": 9,
    "statusDescription": "HTTP error! status: 404",
    "isDelivered": false,
    "deliveryDate": null,
    "summaryCode": null
  },
  "error": "HTTP error! status: 404"
}
```

### Codes de réponse HTTP

| Code | Description |
|------|-------------|
| 200 | Succès - Requête traitée avec succès |
| 400 | Bad Request - Format de requête invalide |
| 401 | Unauthorized - Clé API manquante |
| 403 | Forbidden - Clé API invalide |
| 500 | Internal Server Error - Erreur serveur |

## 🐳 Docker

### Construction de l'image

```bash
docker build -t tnt-track-api .
```

### Exécution du conteneur

**Avec un fichier .env :**

```bash
docker run -d \
  -p 3000:3000 \
  --name tnt-track \
  --env-file .env \
  tnt-track-api
```

**Avec des variables d'environnement :**

```bash
docker run -d \
  -p 3000:3000 \
  --name tnt-track \
  -e TNT_USERNAME=votre_username \
  -e TNT_PASSWORD=votre_password \
  -e TNT_URL=https://api.tnt.fr/endpoint \
  -e API_KEY=votre_cle_api \
  -e PORT=3000 \
  tnt-track-api
```

### Vérification

```bash
# Vérifier que le conteneur tourne
docker ps

# Voir les logs
docker logs tnt-track

# Tester l'endpoint de santé
curl http://localhost:3000/health
```

## 💡 Exemples

### Exemple avec cURL

```bash
curl -X POST http://localhost:3000/track \
  -H "Content-Type: application/json" \
  -H "x-api-key: votre_cle_api" \
  -d '{
    "shipments": [
      {
        "trackingNumber": "3143818594002303",
        "preparationId": 555,
        "contractId": 111,
        "lineId": 222,
        "ticketId": 333,
        "swapId": 444
      }
    ]
  }'
```

### Exemple avec JavaScript (fetch)

```javascript
const response = await fetch('http://localhost:3000/track', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-api-key': 'votre_cle_api'
  },
  body: JSON.stringify({
    shipments: [
      {
        trackingNumber: '3143818594002303',
        preparationId: 555,
        contractId: 111,
        lineId: 222,
        ticketId: 333,
        swapId: 444
      }
    ]
  })
});

const data = await response.json();
console.log(data);
```

### Exemple avec Python (requests)

```python
import requests

url = "http://localhost:3000/track"
headers = {
    "Content-Type": "application/json",
    "x-api-key": "votre_cle_api"
}
data = {
    "shipments": [
        {
            "trackingNumber": "3143818594002303",
            "preparationId": 555,
            "contractId": 111,
            "lineId": 222,
            "ticketId": 333,
            "swapId": 444
        }
    ]
}

response = requests.post(url, json=data, headers=headers)
print(response.json())
```

## 📝 Notes importantes

- L'API traite toutes les expéditions de manière séquentielle
- Les erreurs pour une expédition n'empêchent pas le traitement des autres
- Le champ `summary` est toujours présent dans la réponse, même en cas d'erreur
- Le temps d'exécution peut varier selon le nombre d'expéditions et la latence de l'API TNT
- Assurez-vous de garder votre `API_KEY` secrète et de ne jamais la commiter dans le code

## 🔒 Sécurité

- Toutes les routes protégées nécessitent le header `x-api-key`
- Utilisez HTTPS en production
- Stockez les variables d'environnement de manière sécurisée
- Ne commitez jamais le fichier `.env` dans le contrôle de version

## 📄 Licence

Ce projet est propriétaire.

