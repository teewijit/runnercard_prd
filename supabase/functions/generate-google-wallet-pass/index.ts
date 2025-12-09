import { Hono } from "https://deno.land/x/hono@v3.11.11/mod.ts";
import { cors } from "https://deno.land/x/hono@v3.11.11/middleware.ts";
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.44.0";
import { create, getNumericDate } from "https://deno.land/x/djwt@v2.8/mod.ts";
const app = new Hono();
// Enable CORS for frontend communication
app.use('/*', cors({
  origin: '*',
  allowHeaders: [
    'Content-Type',
    'Authorization'
  ],
  allowMethods: [
    'POST',
    'GET',
    'OPTIONS'
  ]
}));
// Health check endpoint
app.get('/health', (c)=>{
  return c.json({
    status: 'ok',
    message: 'Google Wallet pass generation function is running.'
  });
});
// OPTIONS preflight handler
app.options('/*', (c)=>{
  return c.text('', 204);
});
// Helper function to replace placeholders like {column_name} with runner data
const fillTemplate = (template, runner)=>{
  if (!template || typeof template !== 'string') return '';
  return template.replace(/\{(\w+)\}/g, (match, key)=>{
    const value = runner[key];
    // Return empty string if value is undefined, null, or empty string
    if (value === undefined || value === null || value === '') {
      return '';
    }
    return String(value);
  });
};

// Change to '*' to handle any path prefix sent by Supabase Gateway
app.post('*', async (c)=>{
  try {
    console.log("Start generating Google Wallet pass (Robust Version)...");
    // --- 1. Initialize Supabase Client ---
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      console.error('Supabase environment variables are not set.');
      return c.json({
        error: 'Server configuration error: Supabase credentials missing.'
      }, 500);
    }
    const supabaseClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    // --- 2. Fetch Wallet Configuration (including new field_mappings) ---
    const { data: walletConfig, error: configError } = await supabaseClient.from('wallet_config').select('*').eq('id', 1) // Fetch the config with the fixed ID
    .single();
    if (configError || !walletConfig) {
      console.error('Error fetching wallet configuration:', configError?.message);
      return c.json({
        error: 'Server configuration error: Could not load Google Wallet configuration. Please set it up in the admin dashboard.'
      }, 500);
    }
    const GOOGLE_WALLET_ISSUER_ID = walletConfig.issuer_id;
    if (!GOOGLE_WALLET_ISSUER_ID) {
      return c.json({
        error: 'Server configuration error: Google Wallet Issuer ID is not configured in the database.'
      }, 500);
    }
    // --- 3. Process Request Body (now only expects runnerId) ---
    const { runnerId } = await c.req.json();
    if (!runnerId) {
      return c.json({
        error: 'Invalid payload: missing runnerId.'
      }, 400);
    }
    console.log(`Request for runnerId: ${runnerId}`);
    // --- 4. Fetch the full runner record ---
    const { data: runner, error: runnerError } = await supabaseClient.from('runners').select('*').eq('id', runnerId).single();
    if (runnerError || !runner) {
      console.error(`Error fetching runner with ID ${runnerId}:`, runnerError?.message);
      return c.json({
        error: `Could not find runner with ID ${runnerId}.`
      }, 404);
    }
    
    // Debug: Log runner data for shirt_type and shirt
    console.log("==== DEBUG RUNNER DATA ====");
    console.log("runner.shirt_type:", runner.shirt_type);
    console.log("runner.shirt:", runner.shirt);
    console.log("runner keys:", Object.keys(runner));
    // --- 5. Dynamically Construct Wallet Object using DB Config and Mappings ---
    const { field_mappings } = walletConfig;
    if (!field_mappings) {
      return c.json({
        error: 'Server configuration error: Field mappings are not defined in wallet_config.'
      }, 500);
    }
    const classId = `${GOOGLE_WALLET_ISSUER_ID}.${walletConfig.class_suffix}`;
    const objectId = `${GOOGLE_WALLET_ISSUER_ID}.${runner.access_key}`; // Use access_key for a stable, unique object ID
    // Use configured link or fallback
    const officialLink = walletConfig.official_website_uri || 'https://pay.google.com/gp/v/card/';
    // Fix: Type genericObject as 'any' to allow dynamic property assignment.
console.log("==== DEBUG COLOUR SIGN ====");
console.log("walletConfig.colour_sign =", walletConfig.colour_sign);
console.log("runner.colour_sign =", runner.colour_sign);
console.log("walletConfig.hex_background_color =", walletConfig.hex_background_color);

    // Determine background color based on colour_sign
    let backgroundColor = walletConfig.hex_background_color;
    if (runner.colour_sign == 'VIP') {
      backgroundColor = '#70a8a7';
    } else if (runner.colour_sign == '1 วัน') {
      backgroundColor = '#8c8e90';
    }
    
    // Determine hero image based on colour_sign
    let heroImageUri: string | null = null;
    if (runner.colour_sign == 'VIP') {
      heroImageUri = 'https://owcjaxcgeikzogxnoufb.supabase.co/storage/v1/object/public/pass_assets/BS21%202025_strip-02.png';
    } else if (runner.colour_sign == '1 วัน') {
      heroImageUri = 'https://owcjaxcgeikzogxnoufb.supabase.co/storage/v1/object/public/pass_assets/BS21%202025_strip-03.png';
    } else if (walletConfig.hero_image_uri) {
      heroImageUri = walletConfig.hero_image_uri;
    }
    
    const genericObject: any = {
      'id': objectId,
      'classId': classId,
      'genericType': 'GENERIC_TYPE_UNSPECIFIED',
      'hexBackgroundColor': backgroundColor,
      
      'logo': {
        'sourceUri': {
          'uri': walletConfig.logo_uri
        }
      },
      'cardTitle': {
        'defaultValue': {
          'language': 'en',
            'value': fillTemplate(walletConfig.card_title, runner)
        }
      },
     
      'linksModuleData': {
        'uris': [
          {
            'uri': officialLink,
            'description': 'Official Website',
            'id': 'officialLink'
          }
        ]
      }
    };
    
    // Add hero image if configured
    if (heroImageUri) {
      genericObject.heroImage = {
        sourceUri: {
          uri: heroImageUri
        }
      };
    }
    // Add Location Triggers if configured
    if (walletConfig.eventLatitude && walletConfig.eventLongitude) {
      genericObject.locations = [
        {
          kind: "walletobjects#latLongPoint",
          latitude: parseFloat(walletConfig.eventLatitude),
          longitude: parseFloat(walletConfig.eventLongitude)
        }
      ];
    }
    // Dynamically add fields based on mappings
    if (field_mappings.header?.enabled && field_mappings.header.template) {
      genericObject.header = {
        defaultValue: {
          language: 'en',
          value: fillTemplate(field_mappings.header.template, runner)
        }
      };
    }
    if (field_mappings.subheader?.enabled && field_mappings.subheader.template) {
      genericObject.subheader = {
        defaultValue: {
          language: 'en',
          value: fillTemplate(field_mappings.subheader.template, runner)
        }
      };
    }
    if (field_mappings.barcodeValue?.enabled && field_mappings.barcodeValue.sourceColumn) {
      const barcodeValue = runner[field_mappings.barcodeValue.sourceColumn] || '';
      genericObject.barcode = {
        type: 'QR_CODE',
        value: String(barcodeValue)
        // Removed alternateText to hide the link text below QR code
      };
    }
    // Initialize textModulesData array
    genericObject.textModulesData = [];
    
    // Process informationRows if configured (inside field_mappings, same level as textModules)
    const informationRows = (field_mappings as any).informationRows || [];
    let cardTemplateOverrideConfig: any = null;
    const usedTextModuleIds = new Set<string>(); // Track which textModules are used in cardTemplateOverride
    
    // Add textModules from field_mappings.textModules (these will display outside card)
    // These are separate from informationRows which will display on card via cardTemplateOverride
    if (field_mappings.textModules?.length > 0) {
      genericObject.textModulesData = field_mappings.textModules.map((module)=>({
          id: module.id,
          header: module.header,
          body: fillTemplate(module.bodyTemplate, runner)
        }));
    }
    
    // Debug: Log textModulesData
    console.log("==== DEBUG TEXT MODULES ====");
    console.log("textModulesData:", JSON.stringify(genericObject.textModulesData, null, 2));
    
    console.log("==== DEBUG INFORMATION ROWS ====");
    console.log("informationRows count:", informationRows.length);
    console.log("informationRows data:", JSON.stringify(informationRows, null, 2));
    
    if (informationRows.length > 0) {
        // Create textModules from informationRows and build cardTemplateOverride
        const rowTemplateInfos: any[] = [];
        const additionalTextModules: any[] = [];
        
        informationRows.forEach((row: any, rowIndex: number) => {
          const rowTemplate: any = {};
          let hasLeft = false;
          let hasMiddle = false;
          let hasRight = false;
          
          // Process Left Item
          // Check if label exists (value can be empty string, show only label if value is empty)
          if (row.left?.label) {
            const leftId = `info_row_${rowIndex}_left`;
            const leftLabel = fillTemplate(row.left.label, runner);
            // Skip if label is empty after filling template
            if (leftLabel && leftLabel.trim()) {
              // Google Wallet shows: header (label) and body (value)
              // If value is empty, show only label in body (header will be empty or same as body)
              // If value exists, show label as header and value as body
              const hasLeftValue = row.left.value && row.left.value.trim();
              console.log(`Row ${rowIndex} Left - label: "${row.left.label}" -> "${leftLabel}", value: "${row.left.value || ''}" -> hasValue: ${hasLeftValue}`);
              additionalTextModules.push({
                id: leftId,
                header: hasLeftValue ? leftLabel : '', // Show label as header only if value exists
                body: hasLeftValue ? fillTemplate(row.left.value, runner) : leftLabel // Use label as body if no value
              });
              usedTextModuleIds.add(leftId); // Mark as used in cardTemplateOverride
              rowTemplate.startItem = {
                firstValue: {
                  fields: [
                    {
                      fieldPath: `object.textModulesData['${leftId}']`
                    }
                  ]
                }
              };
              hasLeft = true;
            } else {
              console.log(`Row ${rowIndex} Left - Skipped because label is empty after template fill: "${row.left.label}"`);
            }
          }
          
          // Process Middle Item
          if (row.middle?.label) {
            const middleId = `info_row_${rowIndex}_middle`;
            const middleLabel = fillTemplate(row.middle.label, runner);
            // Skip if label is empty after filling template
            if (middleLabel && middleLabel.trim()) {
              const hasMiddleValue = row.middle.value && row.middle.value.trim();
              console.log(`Row ${rowIndex} Middle - label: "${row.middle.label}" -> "${middleLabel}", value: "${row.middle.value || ''}" -> hasValue: ${hasMiddleValue}`);
              additionalTextModules.push({
                id: middleId,
                header: hasMiddleValue ? middleLabel : '', // Show label as header only if value exists
                body: hasMiddleValue ? fillTemplate(row.middle.value, runner) : middleLabel // Use label as body if no value
              });
              usedTextModuleIds.add(middleId); // Mark as used in cardTemplateOverride
              rowTemplate.middleItem = {
                firstValue: {
                  fields: [
                    {
                      fieldPath: `object.textModulesData['${middleId}']`
                    }
                  ]
                }
              };
              hasMiddle = true;
            } else {
              console.log(`Row ${rowIndex} Middle - Skipped because label is empty after template fill: "${row.middle.label}"`);
            }
          }
          
          // Process Right Item
          if (row.right?.label) {
            const rightId = `info_row_${rowIndex}_right`;
            const rightLabel = fillTemplate(row.right.label, runner);
            // Skip if label is empty after filling template
            if (rightLabel && rightLabel.trim()) {
              const hasRightValue = row.right.value && row.right.value.trim();
              console.log(`Row ${rowIndex} Right - label: "${row.right.label}" -> "${rightLabel}", value: "${row.right.value || ''}" -> hasValue: ${hasRightValue}`);
              additionalTextModules.push({
                id: rightId,
                header: hasRightValue ? rightLabel : '', // Show label as header only if value exists
                body: hasRightValue ? fillTemplate(row.right.value, runner) : rightLabel // Use label as body if no value
              });
              usedTextModuleIds.add(rightId); // Mark as used in cardTemplateOverride
              rowTemplate.endItem = {
                firstValue: {
                  fields: [
                    {
                      fieldPath: `object.textModulesData['${rightId}']`
                    }
                  ]
                }
              };
              hasRight = true;
            } else {
              console.log(`Row ${rowIndex} Right - Skipped because label is empty after template fill: "${row.right.label}"`);
            }
          }
          
          // Determine row type and add to template
          if (hasLeft && hasMiddle && hasRight) {
            rowTemplateInfos.push({ threeItems: rowTemplate });
          } else if (hasLeft && hasRight) {
            rowTemplateInfos.push({ twoItems: rowTemplate });
          }
          // Note: Google Wallet API doesn't support single item rows, so we skip them
        });
        
        // Add additional textModules to textModulesData
        if (additionalTextModules.length > 0) {
          genericObject.textModulesData = [...genericObject.textModulesData, ...additionalTextModules];
          console.log("==== DEBUG ADDITIONAL TEXT MODULES ====");
          console.log("Additional textModules count:", additionalTextModules.length);
          console.log("Additional textModules:", JSON.stringify(additionalTextModules, null, 2));
          console.log("Total textModulesData count:", genericObject.textModulesData.length);
        }
        
        // Create cardTemplateOverride if we have row templates
        if (rowTemplateInfos.length > 0) {
          cardTemplateOverrideConfig = {
            cardRowTemplateInfos: rowTemplateInfos
          };
          console.log("==== DEBUG CARD TEMPLATE OVERRIDE ====");
          console.log("cardTemplateOverride created from informationRows:", JSON.stringify(cardTemplateOverrideConfig, null, 2));
          console.log("Row templates count:", rowTemplateInfos.length);
          
          // IMPORTANT: Google Wallet API requires textModules to exist in textModulesData
          // for cardTemplateOverride to work. cardTemplateOverride references textModules
          // via fieldPath (e.g., object.textModulesData['info_row_0_left']), so the textModules
          // MUST be present in genericObject.textModulesData.
          //
          // However, Google Wallet will automatically display ALL textModules in textModulesData
          // in other sections of the card (like the right sidebar), even if they're also used
          // in cardTemplateOverride. This is a Google Wallet API behavior that cannot be controlled.
          //
          // Therefore, we must keep textModules in textModulesData for cardTemplateOverride to work,
          // but they will also appear in other sections of the card. This is expected behavior.
          // IMPORTANT: Google Wallet API requires textModules to exist in textModulesData
          // for cardTemplateOverride to work. cardTemplateOverride references textModules
          // via fieldPath (e.g., object.textModulesData['info_row_0_left']), so the textModules
          // MUST be present in genericObject.textModulesData.
          //
          // Separation of concerns:
          // - textModules from informationRows: Used in cardTemplateOverride (displayed ON card)
          // - textModules from field_mappings.textModules: Displayed OUTSIDE card (in other sections)
          // - Both types are kept in textModulesData:
          //   * informationRows textModules: Required for cardTemplateOverride to work
          //   * field_mappings.textModules: Will display in other sections automatically
          console.log(`==== DEBUG TEXT MODULES FOR CARD TEMPLATE OVERRIDE ====`);
          console.log(`TextModules from informationRows (used in cardTemplateOverride): ${usedTextModuleIds.size}`);
          console.log(`TextModules from field_mappings.textModules (displayed outside card): ${genericObject.textModulesData.length - usedTextModuleIds.size}`);
          console.log(`Total textModulesData count: ${genericObject.textModulesData.length}`);
          console.log(`Used textModule IDs (from informationRows):`, Array.from(usedTextModuleIds));
          console.log(`Note: informationRows textModules will display ON card via cardTemplateOverride`);
          console.log(`Note: field_mappings.textModules will display OUTSIDE card in other sections`);
        } else {
          console.log("==== DEBUG: No valid row templates created ====");
          console.log("rowTemplateInfos length:", rowTemplateInfos.length);
          console.log("additionalTextModules length:", additionalTextModules.length);
        }
    }
    
    // Fallback to old logic if no informationRows or no valid templates created
    if (!cardTemplateOverrideConfig && genericObject.textModulesData.length > 0) {
        // Fallback: Use old threeItems/twoItems logic
        let startItemId: string | null = null;
        let middleItemId: string | null = null;
        let endItemId: string | null = null;
        let useThreeItems = false;
        
        // Check if threeItems configuration exists in field_mappings
        if ((field_mappings as any).threeItems?.startItemId && (field_mappings as any).threeItems?.middleItemId && (field_mappings as any).threeItems?.endItemId) {
          startItemId = (field_mappings as any).threeItems.startItemId;
          middleItemId = (field_mappings as any).threeItems.middleItemId;
          endItemId = (field_mappings as any).threeItems.endItemId;
          useThreeItems = true;
          console.log("Using threeItems config from field_mappings:", { startItemId, middleItemId, endItemId });
        } else if ((field_mappings as any).twoItems?.startItemId && (field_mappings as any).twoItems?.endItemId) {
          startItemId = (field_mappings as any).twoItems.startItemId;
          endItemId = (field_mappings as any).twoItems.endItemId;
          useThreeItems = false;
          console.log("Using twoItems config from field_mappings:", { startItemId, endItemId });
        } else if (genericObject.textModulesData.length >= 3) {
          startItemId = genericObject.textModulesData[0].id;
          middleItemId = genericObject.textModulesData[1].id;
          endItemId = genericObject.textModulesData[2].id;
          useThreeItems = true;
          console.log("Using first 3 textModules for threeItems:", { startItemId, middleItemId, endItemId });
        } else if (genericObject.textModulesData.length >= 2) {
          startItemId = genericObject.textModulesData[0].id;
          endItemId = genericObject.textModulesData[1].id;
          useThreeItems = false;
          console.log("Using first 2 textModules for twoItems:", { startItemId, endItemId });
        }
        
        // Create cardTemplateOverride from fallback logic
        if (useThreeItems && startItemId && middleItemId && endItemId) {
          const hasStartItem = genericObject.textModulesData.some((module: any) => module.id === startItemId);
          const hasMiddleItem = genericObject.textModulesData.some((module: any) => module.id === middleItemId);
          const hasEndItem = genericObject.textModulesData.some((module: any) => module.id === endItemId);
          
          if (hasStartItem && hasMiddleItem && hasEndItem) {
            cardTemplateOverrideConfig = {
              cardRowTemplateInfos: [
                {
                  threeItems: {
                    startItem: {
                      firstValue: {
                        fields: [{ fieldPath: `object.textModulesData['${startItemId}']` }]
                      }
                    },
                    middleItem: {
                      firstValue: {
                        fields: [{ fieldPath: `object.textModulesData['${middleItemId}']` }]
                      }
                    },
                    endItem: {
                      firstValue: {
                        fields: [{ fieldPath: `object.textModulesData['${endItemId}']` }]
                      }
                    }
                  }
                }
              ]
            };
            console.log("cardTemplateOverride created (threeItems fallback):", JSON.stringify(cardTemplateOverrideConfig, null, 2));
          }
        } else if (!useThreeItems && startItemId && endItemId) {
          const hasStartItem = genericObject.textModulesData.some((module: any) => module.id === startItemId);
          const hasEndItem = genericObject.textModulesData.some((module: any) => module.id === endItemId);
          
          if (hasStartItem && hasEndItem) {
            cardTemplateOverrideConfig = {
              cardRowTemplateInfos: [
                {
                  twoItems: {
                    startItem: {
                      firstValue: {
                        fields: [{ fieldPath: `object.textModulesData['${startItemId}']` }]
                      }
                    },
                    endItem: {
                      firstValue: {
                        fields: [{ fieldPath: `object.textModulesData['${endItemId}']` }]
                      }
                    }
                  }
                }
              ]
            };
            console.log("cardTemplateOverride created (twoItems fallback):", JSON.stringify(cardTemplateOverrideConfig, null, 2));
          }
        }
    }
    
    // Store cardTemplateOverride for later use in classTemplateInfo (class level)
    (genericObject as any).__cardTemplateOverride = cardTemplateOverrideConfig;
    console.log("==== DEBUG STORING CARD TEMPLATE OVERRIDE ====");
    console.log("cardTemplateOverrideConfig stored:", !!cardTemplateOverrideConfig);
    console.log("textModulesData count before storing:", genericObject.textModulesData?.length || 0);
    if (cardTemplateOverrideConfig) {
      console.log("cardTemplateOverrideConfig keys:", Object.keys(cardTemplateOverrideConfig));
    }
    // --- 6. Get Google Service Account Credentials ---
    const GOOGLE_SERVICE_ACCOUNT_CREDENTIALS = Deno.env.get('GOOGLE_SERVICE_ACCOUNT_CREDENTIALS');
    if (!GOOGLE_SERVICE_ACCOUNT_CREDENTIALS) {
      console.error("Missing GOOGLE_SERVICE_ACCOUNT_CREDENTIALS secret");
      return c.json({
        error: 'Server configuration error: Google Service Account credentials are not set in Secrets.'
      }, 500);
    }
    let serviceAccount;
    let privateKey;
    try {
      serviceAccount = JSON.parse(GOOGLE_SERVICE_ACCOUNT_CREDENTIALS);
      // Handle case where JSON.parse returns a string (double escaped)
      if (typeof serviceAccount === 'string') {
        serviceAccount = JSON.parse(serviceAccount);
      }
    } catch (e) {
      console.error("JSON Parse Error:", e.message);
      return c.json({
        error: 'Invalid JSON format in GOOGLE_SERVICE_ACCOUNT_CREDENTIALS secret.'
      }, 500);
    }
    try {
      let pemContents = serviceAccount.private_key;
      if (!pemContents) {
        throw new Error("private_key field is missing in the JSON credentials.");
      }
      // Robustly clean and format the private key PEM
      // 1. Remove standard headers/footers
      pemContents = pemContents.replace(/-----BEGIN PRIVATE KEY-----/g, "").replace(/-----END PRIVATE KEY-----/g, "");
      // 2. Replace literal "\n" characters (common in JSON) with empty string
      pemContents = pemContents.replace(/\\n/g, "");
      // 3. Replace actual newline characters with empty string
      pemContents = pemContents.replace(/\n/g, "");
      // 4. Remove any remaining whitespace
      pemContents = pemContents.replace(/\s/g, "");
      // Decode Base64 to Binary
      const binaryDerString = atob(pemContents);
      const der = new Uint8Array(binaryDerString.length);
      for(let i = 0; i < binaryDerString.length; i++){
        der[i] = binaryDerString.charCodeAt(i);
      }
      // Import Key
      privateKey = await crypto.subtle.importKey("pkcs8", der, {
        name: "RSASSA-PKCS1-v1_5",
        hash: "SHA-256"
      }, true, [
        "sign"
      ]);
    } catch (e) {
      console.error("Private Key Import Error:", e.message);
      return c.json({
        error: `Server configuration error: Failed to process Google Private Key. Details: ${e.message}`
      }, 500);
    }
    // --- 7. Create a real, signed JWT ---
    // Extract cardTemplateOverride from genericObject if it exists
    const extractedCardTemplateOverride = (genericObject as any).__cardTemplateOverride;
    delete (genericObject as any).__cardTemplateOverride; // Remove temporary property
    
    console.log("==== DEBUG EXTRACTING CARD TEMPLATE OVERRIDE ====");
    console.log("cardTemplateOverrideConfig extracted:", !!extractedCardTemplateOverride);
    console.log("textModulesData count after extraction:", genericObject.textModulesData?.length || 0);
    if (extractedCardTemplateOverride) {
      console.log("cardTemplateOverrideConfig:", JSON.stringify(extractedCardTemplateOverride, null, 2));
    }
    
    // Remove cardTemplateOverride from genericObject if it exists (should only be in classTemplateInfo)
    if ((genericObject as any).cardTemplateOverride) {
      delete (genericObject as any).cardTemplateOverride;
      console.log("Removed cardTemplateOverride from genericObject (will use classTemplateInfo instead)");
    }
    
    // Debug: Log genericObject before creating payload
    console.log("==== DEBUG GENERIC OBJECT BEFORE PAYLOAD ====");
    console.log("genericObject keys:", Object.keys(genericObject));
    console.log("Has cardTemplateOverride:", !!(genericObject as any).cardTemplateOverride);
    
    // Create/Update Generic Class via REST API if cardTemplateOverride exists
    // Google Wallet requires Class to be created/updated before creating Objects
    if (extractedCardTemplateOverride && privateKey) {
      try {
        const classPayload = {
          id: classId,
          classTemplateInfo: {
            cardTemplateOverride: extractedCardTemplateOverride
          }
        };
        
        // Get OAuth2 token for Google Wallet API
        const now = Math.floor(Date.now() / 1000);
        const oauthJwt = await create({
          alg: "RS256",
          typ: "JWT"
        }, {
          iss: serviceAccount.client_email,
          scope: 'https://www.googleapis.com/auth/wallet_object.issuer',
          aud: 'https://oauth2.googleapis.com/token',
          exp: now + 3600,
          iat: now
        }, privateKey);
        
        const tokenUrl = `https://oauth2.googleapis.com/token`;
        const tokenResponse = await fetch(tokenUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({
            grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
            assertion: oauthJwt
          })
        });
        
        if (tokenResponse.ok) {
          const tokenData = await tokenResponse.json();
          const accessToken = tokenData.access_token;
          
          // Create or update Generic Class
          const classApiUrl = `https://walletobjects.googleapis.com/walletobjects/v1/genericClass/${encodeURIComponent(classId)}`;
          const classResponse = await fetch(classApiUrl, {
            method: 'PUT',
            headers: {
              'Authorization': `Bearer ${accessToken}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify(classPayload)
          });
          
          if (classResponse.ok) {
            console.log("==== GENERIC CLASS CREATED/UPDATED VIA REST API ====");
            console.log("Class ID:", classId);
            const classData = await classResponse.json();
            console.log("Class response:", JSON.stringify(classData, null, 2));
          } else {
            const errorText = await classResponse.text();
            console.warn("Failed to create/update Generic Class via REST API:", classResponse.status, errorText);
            // Continue anyway - Class might already exist or will be created by JWT
          }
        } else {
          const errorText = await tokenResponse.text();
          console.warn("Failed to get OAuth token for Class creation:", errorText);
          // Continue anyway - Class might be created by JWT
        }
      } catch (e) {
        console.warn("Error creating/updating Generic Class via REST API:", e.message);
        // Continue anyway - Class might be created by JWT
      }
    }
    
    const payload: any = {
      genericObjects: [
        genericObject
      ]
    };
    
    // Add genericClasses with classTemplateInfo if cardTemplateOverride exists
    // According to Google Wallet API, classTemplateInfo should be in genericClasses
    if (extractedCardTemplateOverride) {
      payload.genericClasses = [
        {
          id: classId,
          classTemplateInfo: {
            cardTemplateOverride: extractedCardTemplateOverride
          }
        }
      ];
      console.log("==== DEBUG GENERIC CLASSES ====");
      console.log("genericClasses added to payload:", JSON.stringify(payload.genericClasses, null, 2));
    }
    
    const claims = {
      iss: serviceAccount.client_email,
      aud: 'google',
      origins: [],
      typ: 'savetowallet',
      iat: getNumericDate(0),
      payload: payload
    };
    
    // Debug: Log final payload structure
    console.log("==== DEBUG FINAL PAYLOAD ====");
    console.log("Payload keys:", Object.keys(payload));
    console.log("Has genericClasses:", !!payload.genericClasses);
    console.log("Has genericObjects:", !!payload.genericObjects);
    console.log("textModulesData count:", genericObject.textModulesData?.length || 0);
    if (extractedCardTemplateOverride) {
      console.log("cardTemplateOverride will be added via genericClasses.classTemplateInfo");
    }
    // Log full payload structure for debugging
    console.log("Full payload structure:", JSON.stringify(payload, null, 2));
    try {
      const jwt = await create({
        alg: "RS256",
        typ: "JWT"
      }, claims, privateKey);
      const saveToGoogleWalletLink = `https://pay.google.com/gp/v/save/${jwt}`;
      console.log("Google Wallet link generated successfully.");
      return c.json({
        saveToGoogleWalletLink: saveToGoogleWalletLink,
        message: 'Google Wallet pass link generated successfully.'
      }, 200);
    } catch (e) {
      console.error("JWT Signing Error:", e.message);
      return c.json({
        error: `Failed to sign Google Wallet JWT. Details: ${e.message}`
      }, 500);
    }
  } catch (error) {
    console.error('Error in generate-google-wallet-pass Edge Function:', error);
    return c.json({
      error: error.message || 'Internal server error.'
    }, 500);
  }
});
serve(app.fetch);