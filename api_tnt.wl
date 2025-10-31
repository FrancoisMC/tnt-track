// Structure pour la configuration SQL
STConfiguration est une Structure
	sUtilisateur est une chaîne
	sMotDePasse est une chaîne
	sBaseDeDonnées est une chaîne
	sServeur est une chaîne
	nPort est un entier
FIN

// Structure pour les résultats de tracking
STResultatTracking est une Structure
	nPreparationId est un entier
	nContratId est un entier
	nLigneId est un entier
	nTicketsId est un entier
	nSwapId est un entier
	sTransporteur est une chaîne
	sDateEnvoi est une chaîne
	sCodePostal est une chaîne
	sVille est une chaîne
	sNumeroTracking est une chaîne
	sReponseJSON est une chaîne
FIN

// Procédure de vérification de la clé API
PROCEDURE VerifierCleAPI()
API_KEY est une chaîne = fChargeParamètre("API_KEY")
SI HTTPEntête("x-api-key") = "" ALORS
	HTTPErreur(401, "La clé API est manquante")
	RETOUR
FIN
SI HTTPEntête("x-api-key") <> API_KEY ALORS
	HTTPErreur(403, "Clé API invalide")
	RETOUR
FIN

// Fonction pour obtenir les numéros de tracking depuis SQL Server
PROCEDURE ObtenirNumerosTracking()
LOCAL
	sRequete est une chaîne
	tabResultats est un tableau de STResultatTracking
	
sRequete = [
	SELECT [PREPARATION].[PreparationID],[PREPARATION].[LineID],
	[PREPARATION].[TicketsID],[PREPARATION].[SwapId],[PREPARATION].[ContractID],
	[PREPARATION].[Carrier],[PREPARATION].[TrackingNumber],[PREPARATION].[DateSend],
	[ADDRESS_DELIVERY].[ZipCode],[ADDRESS_DELIVERY].[City] 
	FROM [IRIS].[dbo].[PREPARATION] 
	INNER JOIN [ADDRESS_DELIVERY] ON [ADDRESS_DELIVERY].[AddresseDeliveryID] = [PREPARATION].[AddresseDeliveryID]
	WHERE [Carrier]='TNT' AND [Status]=3 AND [Source] IN (2,6) AND [TrackingNumber]!='' 
	ORDER BY PreparationID DESC
]

SI PAS HExécuteRequête(tabResultats, hRequêteSQL(sRequete)) ALORS
	ErreurDéclenche()
FIN

RENVOYER tabResultats

// Fonction pour appeler l'API TNT
PROCEDURE AppelerAPITNT(sNumeroTracking est une chaîne)
LOCAL
	sPayload est une chaîne JSON
	sReponse est une chaîne
	
// Création du payload JSON
sPayload = [
	{
		"TrackRequest": {
			"searchCriteria": {
				"consignmentNumber": ["%1"],
				"marketType": "domestic",
				"originCountry": "FR"
			},
			"levelOfDetail": {
				"summary": {
					"locale": "FR"
				},
				"pod": {
					"format": "URL"
				}
			},
			"locale": "fr_FR",
			"version": "3.1"
		}
	}
]
sPayload = ChaîneConstruit(sPayload, sNumeroTracking)

// Authentification Basic
sAuth est une chaîne = EncodeBASE64(fChargeParamètre("TNT_USERNAME") + ":" + fChargeParamètre("TNT_PASSWORD"))

// Appel HTTP
requeteHTTP est un httpRequête
requeteHTTP.URL = fChargeParamètre("TNT_URL")
requeteHTTP.Méthode = httpPost
requeteHTTP.ContentType = "application/json"
requeteHTTP.EntêteAjoute("Authorization", "Basic " + sAuth)
requeteHTTP.Contenu = sPayload

SI PAS HTTPEnvoie(requeteHTTP) ALORS
	ErreurDéclenche("Erreur lors de l'appel à l'API TNT")
FIN

RENVOYER requeteHTTP.Réponse

// Procédure principale de mise à jour
PROCEDURE API_MiseAJourStatut()
LOCAL
	tabTracking est un tableau de STResultatTracking
	nDebut est un entier = TimerSys()
	nTotal est un entier
	tabResultats est un tableau associatif
	
// Vérification de la clé API
VerifierCleAPI()

// Récupération des numéros de tracking
tabTracking = ObtenirNumerosTracking()
nTotal = TableauOccurrence(tabTracking)

POUR TOUT tracking DE tabTracking
	reponseAPI est un JSON
	
	// Appel API TNT
	ESSAYER
		reponseAPI = AppelerAPITNT(tracking.sNumeroTracking)
		MiseAJourStatutExpedition(tracking, reponseAPI)
		
		// Ajout au tableau des résultats
		tabResultats.Ajoute({"preparationId": tracking.nPreparationId, ...})
	EXCEPTION
		// Gestion des erreurs
		MiseAJourStatutExpedition(tracking, Null, ExceptionInfo())
		tabResultats.Ajoute({"error": ExceptionInfo(), ...})
	FIN
FIN

// Préparation de la réponse
reponseFinale est un JSON = {
	"stats": {
		"executionTime": (TimerSys() - nDebut) / 1000 + " seconds",
		"totalShipments": nTotal
	},
	"results": tabResultats
}

// Envoi de la réponse
HTTPRéponseChaîne(reponseFinale..JSON, "application/json")

// Point d'entrée de l'API
PROCEDURE API_PRINCIPALE()
SELON HTTPRequête..Méthode
	CAS "GET"
		SI HTTPRequête..URL = "/update" ALORS
			API_MiseAJourStatut()
		SINON SI HTTPRequête..URL COMMENCE PAR "/track/" ALORS
			sNumero est une chaîne = ExtraitChaîne(HTTPRequête..URL, 2, "/")
			reponse est un JSON = AppelerAPITNT(sNumero)
			HTTPRéponseChaîne(reponse..JSON, "application/json")
		FIN
FIN 