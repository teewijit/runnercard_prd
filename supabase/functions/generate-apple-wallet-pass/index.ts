declare namespace Deno {
    const env: {
        get(key: string): string | undefined;
    };
    const serve: (handler: (req: Request) => Response | Promise<Response>) => Promise<void>;
}

import { Hono } from "https://deno.land/x/hono@v3.11.11/mod.ts";
import { cors } from "https://deno.land/x/hono@v3.11.11/middleware.ts";
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.44.0";
import JSZip from "https://esm.sh/jszip@3.10.1";
import forge from "https://esm.sh/node-forge@1.3.1";

const app = new Hono();

app.use('/*', cors({
    origin: '*',
    allowHeaders: ['Content-Type', 'Authorization'],
    allowMethods: ['POST', 'GET', 'OPTIONS'],
}));

app.get('/health', (c) => c.json({ status: 'ok', message: 'Apple Wallet generator is ready.' }));
app.options('/*', (c) => c.text('', 204));

const fillTemplate = (template: string, runner: any) => {
    if (!template) return '';
    // ✅ แก้ไข: รองรับ field ที่มี underscore และตัวอักษรอื่นๆ
    return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (match, key) => {
        const value = runner[key];
        if (value !== undefined && value !== null) {
            return String(value);
        }
        // ✅ เพิ่ม: Log เมื่อไม่พบ field
        console.warn(`⚠️ Template placeholder "${match}" not found in runner data. Available keys: ${Object.keys(runner).join(', ')}`);
        return '';
    });
};

const createHash = (data: string | Uint8Array | ArrayBuffer) => {
    const md = forge.md.sha1.create();

    if (data instanceof ArrayBuffer) {
        data = new Uint8Array(data);
    }

    if (data instanceof Uint8Array) {
        const buffer = forge.util.createBuffer(data.buffer);
        md.update(buffer.getBytes());
    } else {
        md.update(data as string, 'utf8');
    }
    return md.digest().toHex();
};

const fetchImage = async (url: string): Promise<ArrayBuffer | null> => {
    if (!url || typeof url !== 'string') return null;
    const trimmedUrl = url.trim();
    if (!trimmedUrl) return null;

    try {
        new URL(trimmedUrl);
        const separator = trimmedUrl.includes('?') ? '&' : '?';
        const cacheBustedUrl = `${trimmedUrl}${separator}v=${new Date().getTime()}`;

        console.log(`Fetching image: ${cacheBustedUrl}`);
        const res = await fetch(cacheBustedUrl);
        if (res.ok) return await res.arrayBuffer();
        console.warn(`Failed to fetch image ${trimmedUrl}: ${res.status}`);
    } catch (e) {
        console.error(`Exception fetching image '${trimmedUrl}':`, e);
    }
    return null;
};

// ✅ ฟังก์ชัน cleanPem ที่มี debug logging
const cleanPem = (str: string, certName: string = 'Certificate') => {
    console.log(`🧹 Cleaning ${certName}...`);
    
    if (!str) {
        console.error(`❌ ${certName} is empty or undefined`);
        throw new Error(`${certName} is empty`);
    }
    
    console.log(`📏 Original length: ${str.length} chars`);
    
    // 1. ลบ whitespace ข้างหน้าและข้างหลัง
    let s = str.trim();
    
    // 2. แปลง \\n เป็น newline จริง
    const hadBackslashN = s.includes('\\n');
    s = s.replace(/\\n/g, '\n');
    if (hadBackslashN) {
        console.log('✅ Converted \\n to actual newlines');
    }
    
    // 3. ลบ quotes ที่ล้อมรอบ
    const hadQuotes = s.startsWith('"') || s.startsWith("'");
    s = s.replace(/^["']|["']$/g, '');
    if (hadQuotes) {
        console.log('✅ Removed surrounding quotes');
    }
    
    // 4. ลบ escaped quotes
    s = s.replace(/\\"/g, '"');
    s = s.replace(/\\'/g, "'");
    
    // 5. ค้นหา header และ footer
    const headerRegex = /-----BEGIN [A-Z\s]+-----/;
    const footerRegex = /-----END [A-Z\s]+-----/;
    
    const headerMatch = s.match(headerRegex);
    const footerMatch = s.match(footerRegex);
    
    if (!headerMatch) {
        console.error(`❌ ${certName}: Missing BEGIN header`);
        console.log('📄 First 200 chars:', s.substring(0, 200));
        throw new Error(`${certName}: Invalid PEM format - Missing BEGIN header`);
    }
    
    if (!footerMatch) {
        console.error(`❌ ${certName}: Missing END footer`);
        console.log('📄 Last 200 chars:', s.substring(s.length - 200));
        throw new Error(`${certName}: Invalid PEM format - Missing END footer`);
    }
    
    const header = headerMatch[0];
    const footer = footerMatch[0];
    const start = s.indexOf(header) + header.length;
    const end = s.indexOf(footer);
    
    console.log(`📋 Header: "${header}"`);
    console.log(`📋 Footer: "${footer}"`);
    
    if (end < start) {
        console.error(`❌ ${certName}: Footer appears before header`);
        throw new Error(`${certName}: Invalid PEM format - Malformed structure`);
    }
    
    // 6. ดึง base64 body และลบทุก whitespace
    const body = s.substring(start, end)
        .replace(/\s+/g, '')
        .trim();
    
    console.log(`📏 Body length: ${body.length} chars`);
    
    if (body.length === 0) {
        console.error(`❌ ${certName}: Body is empty`);
        throw new Error(`${certName}: PEM body is empty`);
    }
    
    // 7. ตรวจสอบว่า base64 ถูกต้อง
    if (!/^[A-Za-z0-9+/=]+$/.test(body)) {
        const invalidChars = body.match(/[^A-Za-z0-9+/=]/g);
        console.error(`❌ ${certName}: Invalid base64 characters found:`, invalidChars?.slice(0, 10));
        console.log('📄 Body preview (first 100 chars):', body.substring(0, 100));
        throw new Error(`${certName}: Body contains invalid base64 characters`);
    }
    
    // 8. แบ่ง base64 เป็นบรรทัดละ 64 ตัวอักษร
    const chunkedBody = body.match(/.{1,64}/g)?.join('\n') || body;
    
    // 9. สร้าง PEM ที่ถูกต้อง
    const cleanedPem = `${header}\n${chunkedBody}\n${footer}`;
    
    console.log(`✅ ${certName} cleaned successfully`);
    console.log(`📏 Final length: ${cleanedPem.length} chars (${chunkedBody.split('\n').length} lines in body)`);
    
    return cleanedPem;
};

// ✅ ฟังก์ชัน parseCertFallback ที่มี debug logging
const parseCertFallback = (pem: string, certName: string = 'Certificate') => {
    console.log(`🔍 Parsing ${certName}...`);
    
    const pki = forge.pki;
    
    try {
        // พยายาม parse แบบปกติ
        const cert = pki.certificateFromPem(pem);
        console.log(`✅ ${certName} parsed successfully (standard method)`);
        
        // แสดงข้อมูลพื้นฐาน
        const subject = cert.subject.attributes
            .map((attr: any) => `${attr.shortName}=${attr.value}`)
            .join(', ');
        console.log(`📋 Subject: ${subject}`);
        
        return cert;
    } catch (e) {
        const error = e as Error;
        console.warn(`⚠️ ${certName}: Standard PEM parse failed:`, error.message);
        console.log("🔄 Trying ASN.1 fallback...");
        
        try {
            // ดึง base64 จาก PEM
            const base64 = pem
                .replace(/-----BEGIN [A-Z\s]+-----/, '')
                .replace(/-----END [A-Z\s]+-----/, '')
                .replace(/\s/g, '');
            
            if (!base64) {
                throw new Error('Empty base64 content after stripping headers');
            }
            
            console.log(`📏 Base64 length for fallback: ${base64.length} chars`);
            
            // แปลง base64 เป็น DER
            const der = forge.util.decode64(base64);
            console.log(`📏 DER length: ${der.length} bytes`);
            
            // แปลง DER เป็น ASN.1
            const asn1 = forge.asn1.fromDer(der);
            console.log('✅ ASN.1 structure created');
            
            // แปลง ASN.1 เป็น Certificate object
            const cert = pki.certificateFromAsn1(asn1);
            
            console.log(`✅ ${certName} parsed successfully (ASN.1 fallback)`);
            
            // แสดงข้อมูลพื้นฐาน
            const subject = cert.subject.attributes
                .map((attr: any) => `${attr.shortName}=${attr.value}`)
                .join(', ');
            console.log(`📋 Subject: ${subject}`);
            
            return cert;
        } catch (innerError) {
            const inner = innerError as Error;
            console.error(`❌ ${certName}: ASN.1 Fallback parse failed:`, inner.message);
            console.error('Stack:', inner.stack);
            throw new Error(
                `${certName}: Failed to parse. ` +
                `Original error: ${error.message}. ` +
                `Fallback error: ${inner.message}`
            );
        }
    }
};

// ฟังก์ชันสร้างรูปภาพในหลายขนาด
const createMultiResolutionImages = async (
    zip: any,
    manifest: Record<string, string>,
    baseBuffer: ArrayBuffer | null,
    baseName: string
) => {
    if (!baseBuffer) return;

    // เพิ่มรูปขนาดปกติ
    zip.file(`${baseName}.png`, baseBuffer);
    manifest[`${baseName}.png`] = createHash(baseBuffer);

    // สำหรับ icon ต้องมี @2x และ @3x ด้วย
    if (baseName === 'icon') {
        zip.file(`${baseName}@2x.png`, baseBuffer);
        manifest[`${baseName}@2x.png`] = createHash(baseBuffer);

        zip.file(`${baseName}@3x.png`, baseBuffer);
        manifest[`${baseName}@3x.png`] = createHash(baseBuffer);
    }
};

const handleRequest = async (c: any) => {
    try {
        console.log(`Start generating pass (${c.req.method})...`);

        // 1. Load Environment Variables
        const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
        const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

        const wwdrPemRaw = Deno.env.get('PASS_WWDR2') || '';
        const signerCertPemRaw = Deno.env.get('PASS_SIGNER_CERT') || '';
        const signerKeyPemRaw = Deno.env.get('PASS_SIGNER_KEY') || '';

        if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
            return c.json({ error: 'Server configuration error: Missing Supabase credentials.' }, 500);
        }
        if (!wwdrPemRaw || !signerCertPemRaw || !signerKeyPemRaw) {
            return c.json({
                error: 'Server configuration error: Missing Apple Wallet Certificates.',
                hint: 'Required: PASS_WWDR (G4), PASS_SIGNER_CERT, PASS_SIGNER_KEY'
            }, 500);
        }

        // 2. Initialize Supabase
        const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

        // 3. Get Request Data
        let runnerId;
        if (c.req.method === 'GET') {
            runnerId = c.req.query('runnerId');
        } else {
            try {
                const body = await c.req.json();
                runnerId = body.runnerId;
            } catch (e) {
                console.warn("Failed to parse JSON body, falling back to query param");
                runnerId = c.req.query('runnerId');
            }
        }

        if (!runnerId) return c.json({ error: 'Missing runnerId' }, 400);
        console.log(`Request for runnerId: ${runnerId}`);

        // 4. Fetch Data from DB
        const { data: walletConfig, error: walletError } = await supabase.from('wallet_config').select('*').single();
        const { data: runner, error: runnerError } = await supabase.from('runners').select('*').eq('id', runnerId).single();

        if (walletError || !walletConfig) return c.json({ error: 'Wallet config not found' }, 404);
        if (runnerError || !runner) return c.json({ error: 'Runner not found' }, 404);

        const appleConfig = walletConfig.apple_wallet_config;
        if (!appleConfig) return c.json({ error: 'Apple Wallet not configured' }, 500);
        
        // ✅ เพิ่ม: Debug logging สำหรับ appleConfig
        console.log('📱 === APPLE CONFIG DEBUG ===');
        console.log('Apple config keys:', Object.keys(appleConfig));
        console.log('Has field_mappings:', !!appleConfig.field_mappings);
        if (appleConfig.field_mappings) {
            console.log('Field mappings type:', typeof appleConfig.field_mappings);
            console.log('Field mappings:', JSON.stringify(appleConfig.field_mappings, null, 2));
        }

        // Validate required fields according to Apple Wallet specifications
        if (!appleConfig.passTypeId || !appleConfig.teamId) {
            return c.json({
                error: 'Missing required configuration',
                details: 'passTypeIdentifier and teamIdentifier are required for Apple Wallet passes',
                missing: {
                    passTypeId: !appleConfig.passTypeId,
                    teamId: !appleConfig.teamId
                }
            }, 500);
        }

        // Validate passTypeId format (should be reverse domain format: pass.com.example.app)
        if (!/^pass\.([a-z0-9-]+\.)+[a-z]{2,}$/i.test(appleConfig.passTypeId)) {
            console.warn(`⚠️ Warning: passTypeId format may be incorrect: ${appleConfig.passTypeId}`);
        }

        // Validate teamId format (should be 10 alphanumeric characters)
        if (!/^[A-Z0-9]{10}$/i.test(appleConfig.teamId)) {
            console.warn(`⚠️ Warning: teamId format may be incorrect: ${appleConfig.teamId}`);
        }

        const barcodeKey = appleConfig.barcodeValueSource || 'bib';
        const barcodeValue = runner[barcodeKey] !== undefined && runner[barcodeKey] !== null ? String(runner[barcodeKey]) : runner.bib;

        // ✅ แก้ไข: ตรวจสอบและ parse field_mappings อย่างระมัดระวัง
        let fieldMappings: any = {};
        
        if (appleConfig.field_mappings) {
            // ถ้า field_mappings เป็น string (JSON string) ให้ parse
            if (typeof appleConfig.field_mappings === 'string') {
                try {
                    fieldMappings = JSON.parse(appleConfig.field_mappings);
                } catch (e) {
                    console.error('❌ Failed to parse field_mappings as JSON:', e);
                    fieldMappings = {};
                }
            } else if (typeof appleConfig.field_mappings === 'object') {
                fieldMappings = appleConfig.field_mappings;
            }
        }

        // ✅ เพิ่ม: Debug logging สำหรับ field_mappings
        console.log('📋 === FIELD MAPPINGS DEBUG ===');
        console.log('Field mappings from config:', JSON.stringify(fieldMappings, null, 2));
        console.log('Field mappings type:', typeof fieldMappings);
        console.log('Runner data keys:', Object.keys(runner));
        console.log('Runner sample data:', {
            bib: runner.bib,
            name_on_bib: runner.name_on_bib,
            wave_start: runner.wave_start,
            block: runner.block,
            first_name: runner.first_name,
            last_name: runner.last_name
        });

        // ✅ เพิ่ม: รองรับ Google Wallet style config (header, subheader, informationRows)
        const googleStyleHeader = (fieldMappings as any).header;
        const googleStyleSubheader = (fieldMappings as any).subheader;
        const informationRows = (fieldMappings as any).informationRows || [];
        
        console.log('📋 Google Wallet style config detected:');
        console.log(`  - header: ${googleStyleHeader ? 'present' : 'not present'}`);
        console.log(`  - subheader: ${googleStyleSubheader ? 'present' : 'not present'}`);
        console.log(`  - informationRows: ${informationRows.length} rows`);
        
        // ✅ แปลง Google Wallet header เป็น Apple Wallet headerFields
        const convertedHeaderFields: any[] = [];
        if (googleStyleHeader && googleStyleHeader.enabled && googleStyleHeader.template) {
            const headerValue = fillTemplate(googleStyleHeader.template, runner);
            if (headerValue && headerValue.trim()) {
                convertedHeaderFields.push({
                    key: 'google_header',
                    label: '',
                    value: headerValue
                });
                console.log(`✅ Converted Google Wallet header: "${headerValue}"`);
            }
        }
        
        // ✅ แปลง Google Wallet subheader เป็น Apple Wallet primaryFields field ที่ 2
        // เพราะ Apple Wallet ไม่มี subheader โดยตรง และ primaryFields สามารถมีได้ 2 fields
        const convertedSubheaderToPrimary: any[] = [];
        if (googleStyleSubheader && googleStyleSubheader.enabled && googleStyleSubheader.template) {
            const subheaderValue = fillTemplate(googleStyleSubheader.template, runner);
            if (subheaderValue && subheaderValue.trim()) {
                convertedSubheaderToPrimary.push({
                    key: 'google_subheader',
                    label: '',
                    value: subheaderValue
                });
                console.log(`✅ Converted Google Wallet subheader to primaryFields[1]: "${subheaderValue}"`);
            }
        }
        
        // ✅ แปลง informationRows เป็น Apple Wallet fields
        // informationRows จะถูกแปลงเป็น auxiliaryFields
        const convertedFieldsFromRows: any[] = [];
        if (informationRows.length > 0) {
            console.log('🔄 Converting informationRows to Apple Wallet fields...');
            informationRows.forEach((row: any, rowIndex: number) => {
                // Process left, middle, right items from informationRows
                ['left', 'middle', 'right'].forEach((position: string) => {
                    const item = row[position];
                    if (item && item.label) {
                        const label = fillTemplate(item.label, runner);
                        if (label && label.trim()) {
                            const value = item.value ? fillTemplate(item.value, runner) : '';
                            // ถ้ามี value ให้แสดง label และ value, ถ้าไม่มี value ให้แสดงแค่ label
                            const displayValue = value && value.trim() ? value : label;
                            
                            convertedFieldsFromRows.push({
                                key: `info_row_${rowIndex}_${position}`,
                                label: value && value.trim() ? label : '', // ถ้ามี value ให้แสดง label, ถ้าไม่มีให้ label เป็น empty
                                value: displayValue
                            });
                            
                            console.log(`  ✅ Row ${rowIndex} ${position}: "${label}" -> "${displayValue}"`);
                        }
                    }
                });
            });
            console.log(`✅ Converted ${convertedFieldsFromRows.length} fields from informationRows`);
        }

        // Ensure field_mappings has all required arrays
        // ✅ รวม fields จาก Google Wallet style config (header, subheader, informationRows)
        const safeFieldMappings = {
            headerFields: [
                ...(Array.isArray(fieldMappings.headerFields) ? fieldMappings.headerFields : []),
                ...convertedHeaderFields // ✅ เพิ่ม header จาก Google Wallet config
            ],
            primaryFields: [
                ...(Array.isArray(fieldMappings.primaryFields) ? fieldMappings.primaryFields : []),
                ...convertedSubheaderToPrimary // ✅ เพิ่ม subheader จาก Google Wallet config เป็น primaryFields field ที่ 2
            ],
            secondaryFields: Array.isArray(fieldMappings.secondaryFields) ? fieldMappings.secondaryFields : [],
            auxiliaryFields: [
                ...(Array.isArray(fieldMappings.auxiliaryFields) ? fieldMappings.auxiliaryFields : []),
                ...convertedFieldsFromRows // ✅ เพิ่ม fields จาก informationRows
            ],
            backFields: Array.isArray(fieldMappings.backFields) ? fieldMappings.backFields : [],
        };

        console.log('✅ Safe field mappings:', {
            headerFields: safeFieldMappings.headerFields.length,
            primaryFields: safeFieldMappings.primaryFields.length,
            secondaryFields: safeFieldMappings.secondaryFields.length,
            auxiliaryFields: safeFieldMappings.auxiliaryFields.length,
            backFields: safeFieldMappings.backFields.length
        });

        const getFields = (fields: any[], fieldType: string) => {
            if (!Array.isArray(fields)) {
                console.warn(`⚠️ ${fieldType}: fields is not an array, got: ${typeof fields}`);
                return [];
            }
            
            if (fields.length === 0) {
                console.log(`ℹ️ ${fieldType}: No fields configured`);
                return [];
            }
            
            console.log(`📝 Processing ${fieldType}: ${fields.length} fields`);
            
            const processedFields = fields.map((f: any, index: number) => {
                // ✅ แก้ไข: ตรวจสอบว่า field object มีโครงสร้างถูกต้อง
                if (!f || typeof f !== 'object') {
                    console.warn(`⚠️ ${fieldType}[${index}]: Invalid field object:`, f);
                    return null;
                }
                
                const valueTemplate = f.valueTemplate || '';
                const filledValue = fillTemplate(valueTemplate, runner);
                
                // ✅ เพิ่ม: รองรับ template ใน label ด้วย (เช่น label: "{race_kit}")
                const labelTemplate = f.label || '';
                const filledLabel = fillTemplate(labelTemplate, runner);
                
                console.log(`  [${index}] Key: "${f.key || 'missing'}", Label Template: "${labelTemplate}", Label Filled: "${filledLabel}", Value Template: "${valueTemplate}", Value Filled: "${filledValue}"`);
                
                return {
                    key: f.key || `field_${index}`,
                    label: filledLabel || labelTemplate, // ใช้ filled label ถ้ามี, ถ้าไม่มีใช้ label template เดิม
                    value: filledValue
                };
            }).filter((f): f is { key: string; label: string; value: string } => f !== null);
            
            // ✅ แก้ไข: สำหรับ primaryFields อย่า filter empty values ออก (เพราะ Apple Wallet ต้องการอย่างน้อย 1 field)
            // แต่สำหรับ field อื่นๆ ให้ filter empty values ออก
            const filteredFields = fieldType === 'primaryFields' 
                ? processedFields 
                : processedFields.filter(f => f.value !== '');
            
            console.log(`✅ ${fieldType}: ${filteredFields.length}/${processedFields.length} fields processed`);
            
            return filteredFields;
        };

        // 5. Construct pass.json according to Apple Wallet specifications
        // Validate required fields
        if (!appleConfig.passTypeId || !appleConfig.teamId || !appleConfig.organizationName) {
            return c.json({
                error: 'Missing required fields in Apple Wallet config',
                required: ['passTypeId', 'teamId', 'organizationName']
            }, 500);
        }

        // ✅ Generic pass type: headerFields (optional), primaryFields (required, max 2 fields)
        const headerFields = getFields(safeFieldMappings.headerFields || [], 'headerFields');
        const allPrimaryFields = getFields(safeFieldMappings.primaryFields, 'primaryFields');
        
        // ✅ Apple Wallet spec: primaryFields สามารถมีได้สูงสุด 2 fields
        const primaryFields = allPrimaryFields.slice(0, 2);
        if (allPrimaryFields.length > 2) {
            console.warn(`⚠️ primaryFields มี ${allPrimaryFields.length} fields แต่ Apple Wallet รองรับสูงสุด 2 fields. จะใช้แค่ 2 fields แรก`);
        }
        
        if (primaryFields.length === 0) {
            console.error('❌ No primary fields found after processing');
            return c.json({
                error: 'At least one primary field is required for generic pass',
                debug: {
                    fieldMappingsCount: safeFieldMappings.primaryFields.length,
                    runnerKeys: Object.keys(runner)
                }
            }, 500);
        }
        
        console.log(`✅ Primary fields: ${primaryFields.length} field(s) (${primaryFields.map(f => f.key).join(', ')})`);

        // ✅ เพิ่ม: ตรวจสอบ serialNumber ว่าไม่ว่างและ unique
        const serialNumber = runner.access_key || String(runner.id);
        if (!serialNumber || serialNumber.trim() === '') {
            return c.json({ 
                error: 'Invalid serialNumber: runner must have access_key or id' 
            }, 500);
        }

        // ✅ เพิ่ม: ตรวจสอบ barcodeValue ว่าไม่ว่าง
        if (!barcodeValue || String(barcodeValue).trim() === '') {
            console.warn('⚠️ Barcode value is empty, using serialNumber as fallback');
        }

        // ✅ เพิ่ม: Validate และ trim organizationName (อาจมี trailing space)
        const organizationName = (appleConfig.organizationName || '').trim();
        if (!organizationName) {
            return c.json({ 
                error: 'organizationName is required and cannot be empty' 
            }, 500);
        }

        // ✅ เพิ่ม: Validate barcode message ไม่ควรเป็น empty
        const barcodeMessage = String(barcodeValue || serialNumber).trim();
        if (!barcodeMessage) {
            return c.json({ 
                error: 'Barcode message cannot be empty. Please set barcodeValueSource or ensure runner has access_key/id' 
            }, 500);
        }

        // ✅ เพิ่ม: Mock data เพื่อดูตำแหน่งของแต่ละ field ใน Apple Wallet card
        // ตั้งเป็น true เพื่อใช้ mock data, false เพื่อใช้ค่าจริง
        const USE_MOCK_DATA = false; // 🔧 เปลี่ยนเป็น false เมื่อต้องการใช้ค่าจริง
        
        let finalHeaderFields = headerFields;
        let finalPrimaryFields = primaryFields;
        let finalSecondaryFields = getFields(safeFieldMappings.secondaryFields, 'secondaryFields');
        let finalAuxiliaryFields = getFields(safeFieldMappings.auxiliaryFields, 'auxiliaryFields');
        let finalBackFields = getFields(safeFieldMappings.backFields, 'backFields');
        
        if (USE_MOCK_DATA) {
            console.log('🎭 === USING MOCK DATA TO SHOW FIELD POSITIONS ===');
            
            // Mock headerFields - ไม่ใช้ (ข้ามไปใช้ secondaryFields แทน)
            finalHeaderFields = [];
            
            // Mock primaryFields - แสดงเป็นข้อมูลหลัก (large text, max 2 fields)
            // ✅ ตามรูปภาพ: Primary Field = ชื่อผู้ใช้ (แสดงใหญ่, ไม่มี label "BIB")
            if (finalPrimaryFields.length === 0) {
                finalPrimaryFields = [{
                    key: 'mock_primary1',
                    label: 'รับบิบ วันศุกร์ 19 ธ.ค. 12:00-20:00 น. หรือ เสาร์ 20 ธ.ค. 10:00-19:00 น.', 
                    value: 'Pornchai Ngamkham'
                }];
            } else {
                finalPrimaryFields = finalPrimaryFields.map((f, index) => ({
                    ...f,
                    // ✅ ใช้ label ที่ตั้งค่าไว้ (ไม่ลบ label ออก)
                    label: index === 0 ? 'รับบิบ วันศุกร์ 19 ธ.ค. 12:00-20:00 น. หรือ เสาร์ 20 ธ.ค. 10:00-19:00 น.' : f.label,
                    value: index === 0 ? 'Pornchai Ngamkham' : `[PRIMARY ${index + 1}] ${f.value || f.label}`
                }));
            }
            
            // Mock secondaryFields - แสดงใต้ primaryFields (medium text)
            // ✅ ตามรูปภาพ: BIB แสดงในตำแหน่ง SECONDARY 1, BLOCK แสดงในตำแหน่ง SECONDARY 2
            // ✅ ตามเอกสาร Apple: secondaryFields แสดงใต้ primaryFields และรองรับหลาย fields (จำกัดที่ 4 fields ต่อแถว)
            finalSecondaryFields = [
                {
                    key: 'mock_secondary1',
                    label: 'BIB',
                    value: '90457'
                },
                {
                    key: 'mock_secondary2',
                    label: 'BLOCK',
                    value: 'B4'
                }
            ];
            
            // Mock auxiliaryFields - แสดงใต้ secondaryFields (small text)
            // ✅ ตามรูปภาพ: แสดงแค่ 3 fields (3 columns)
            // ✅ Field 1: label = 'เสื้อแขนสั้น', value = 'L (42*28.5)'
            // ✅ ตามเอกสาร Apple: auxiliaryFields แสดงใต้ secondaryFields และรองรับหลาย fields (จำกัดที่ 4 fields ต่อแถว)
            // ✅ เมื่อ USE_MOCK_DATA = true ให้ใช้ mock data ทั้งหมดเสมอ
            finalAuxiliaryFields = [
                {
                    key: 'mock_aux1',
                    label: 'เสื้อแขนสั้น',
                    value: 'L (42*28.5)'
                },
                {
                    key: 'mock_aux2',
                    label: 'ROW',
                    value: 'VIP 3'
                },
                {
                    key: 'mock_aux3',
                    label: 'Pre-Order',
                    value: '[มี]'
                }
            ];
            
            // Mock backFields - แสดงเมื่อพลิกบัตร (back side)
            // ✅ ใช้ backFields สำหรับข้อมูลเพิ่มเติมที่ไม่อยู่ใน auxiliaryFields
            if (finalBackFields.length === 0) {
                finalBackFields = [
                    {
                        key: 'mock_back1',
                        label: '[BACK FIELD 1]',
                        value: 'Back Field 1 - แสดงเมื่อพลิกบัตร (ด้านหลัง)'
                    },
                    {
                        key: 'mock_back2',
                        label: 'เสื้อแขนสั้น',
                        value: 'L (42*28.5)'
                    },
                    {
                        key: 'mock_back3',
                        label: 'Pre-Order',
                        value: '[ไม่มี]'
                    }
                ];
            } else {
                finalBackFields = finalBackFields.map((f, index) => ({
                    ...f,
                    value: `[BACK ${index + 1}] ${f.value || f.label}`
                }));
            }
            
            console.log('📋 Mock Data Summary:');
            console.log(`  - headerFields: ${finalHeaderFields.length} field(s)`);
            console.log(`  - primaryFields: ${finalPrimaryFields.length} field(s)`);
            console.log(`  - secondaryFields: ${finalSecondaryFields.length} field(s)`);
            console.log(`  - auxiliaryFields: ${finalAuxiliaryFields.length} field(s)`);
            console.log(`  - backFields: ${finalBackFields.length} field(s)`);
        }

        // ✅ เพิ่ม: Log primaryFields เพื่อตรวจสอบว่า label ถูกส่งไปหรือไม่
        console.log('🔍 === PRIMARY FIELDS DEBUG ===');
        finalPrimaryFields.forEach((f, index) => {
            console.log(`  [${index}] Key: "${f.key}", Label: "${f.label}", Value: "${f.value}"`);
        });
        
        // ✅ เพิ่ม: กำหนด Background Color ตามเงื่อนไข colour_sign
        let backgroundColor = appleConfig.backgroundColor || 'rgb(0, 0, 0)';
        
        // ✅ ตรวจสอบ colour_sign และเปลี่ยนสี Background Color ตามเงื่อนไข
        if (runner.colour_sign == 'VIP') {
            backgroundColor = '#70a8a7';
            console.log(`🎨 Background color changed to VIP color: ${backgroundColor}`);
        } else if (runner.colour_sign == '1 วัน') {
            backgroundColor = '#8c8e90';
            console.log(`🎨 Background color changed to "1 วัน" color: ${backgroundColor}`);
        } else {
            console.log(`🎨 Using configured background color: ${backgroundColor}`);
        }
        
        const passJson: any = {
            formatVersion: 1, // Required: Must be number, not string
            passTypeIdentifier: appleConfig.passTypeId, // Required
            serialNumber: serialNumber.trim(), // Required: Must be unique and non-empty
            teamIdentifier: appleConfig.teamId, // Required
            organizationName: organizationName, // Required (trimmed)
            description: appleConfig.description || 'Event Pass', // Required
            foregroundColor: appleConfig.foregroundColor || 'rgb(255, 255, 255)',
            backgroundColor: backgroundColor, // ✅ ใช้สีที่กำหนดตามเงื่อนไข
            labelColor: appleConfig.labelColor || 'rgb(255, 255, 255)',
            // ✅ เปลี่ยนเป็น generic pass type
            generic: {
                headerFields: finalHeaderFields.length > 0 ? finalHeaderFields : undefined, // Optional: Only add if has fields
                primaryFields: finalPrimaryFields, // Required: At least one
                secondaryFields: finalSecondaryFields.length > 0 ? finalSecondaryFields : undefined, // Optional
                auxiliaryFields: finalAuxiliaryFields.length > 0 ? finalAuxiliaryFields : undefined, // Optional
                backFields: finalBackFields.length > 0 ? finalBackFields : undefined, // Optional
            },
            // ✅ แก้ไข: ใช้ barcodes (array) แทน barcode (object)
            barcodes: [{
                message: barcodeMessage, // Validated: not empty
                format: appleConfig.barcodeFormat || "PKBarcodeFormatQR",
                messageEncoding: "utf-8" // เปลี่ยนเป็น utf-8 เพื่อรองรับภาษาไทย
                // ✅ ลบ altText ออกเพื่อไม่ให้แสดงตัวเลขด้านล่าง QR code
            }],

            // ✅ เพิ่ม: Backward compatibility สำหรับ iOS เก่า
            barcode: {
                message: barcodeMessage, // Validated: not empty
                format: appleConfig.barcodeFormat || "PKBarcodeFormatQR",
                messageEncoding: "utf-8"
            }
        };

        // Optional: logoText - only add if provided (replaces logo.png text)
        if (appleConfig.logoText) {
            passJson.logoText = appleConfig.logoText;
        }
        
        // ✅ เพิ่ม: Log primaryFields ที่ถูกส่งไปใน pass.json
        if (passJson.generic.primaryFields) {
            console.log(`📊 Primary Fields in pass.json: ${passJson.generic.primaryFields.length} field(s)`);
            passJson.generic.primaryFields.forEach((f: any, index: number) => {
                console.log(`  [${index + 1}] Key: "${f.key}", Label: "${f.label || '(empty)'}", Value: "${f.value}"`);
            });
        } else {
            console.log('📊 Primary Fields in pass.json: undefined (no primaryFields)');
        }
        
        // ✅ เพิ่ม: Log secondaryFields ที่ถูกส่งไปใน pass.json
        if (passJson.generic.secondaryFields) {
            console.log(`📊 Secondary Fields in pass.json: ${passJson.generic.secondaryFields.length} field(s)`);
            passJson.generic.secondaryFields.forEach((f: any, index: number) => {
                console.log(`  [${index + 1}] Key: "${f.key}", Label: "${f.label || '(empty)'}", Value: "${f.value}"`);
            });
        } else {
            console.log('📊 Secondary Fields in pass.json: undefined (no secondaryFields)');
        }

        // ✅ Validate and format relevantDate as ISO 8601
        // ⚠️ สำคัญ: relevantDate ที่เป็นวันที่ในอดีตจะทำให้ iOS คิดว่าบัตรหมดอายุ
        // แม้ว่า expirationDate จะเป็นอนาคตก็ตาม
        if (appleConfig.relevantDate) {
            try {
                const date = new Date(appleConfig.relevantDate);
                if (!isNaN(date.getTime())) {
                    const now = new Date();
                    // ⚠️ ตรวจสอบว่า relevantDate ไม่ใช่วันที่ในอดีต
                    if (date < now) {
                        console.warn(`⚠️ relevantDate is in the past: ${date.toISOString()}. This will cause iOS to mark pass as expired.`);
                        console.warn(`⚠️ Skipping relevantDate to prevent pass from being marked as expired.`);
                        // ✅ ไม่เพิ่ม relevantDate ถ้าเป็นวันที่ในอดีต เพื่อป้องกันไม่ให้บัตรถูกย้ายไป "บัตรที่หมดอายุ"
                        // ถ้าต้องการให้ pass ยังแสดงบน lock screen ให้ตั้ง relevantDate เป็นวันที่ในอนาคต
                    } else {
                        // Format as ISO 8601: "2024-05-28T12:00:00Z"
                        passJson.relevantDate = date.toISOString();
                        console.log(`✅ relevantDate: ${passJson.relevantDate}`);
                    }
                } else {
                    console.warn(`⚠️ Invalid relevantDate: ${appleConfig.relevantDate}`);
                }
            } catch (e) {
                console.error(`❌ Error parsing relevantDate: ${e}`);
            }
        }

        // ✅ เพิ่ม: ตั้งค่า expirationDate เพื่อป้องกันไม่ให้บัตรถูกย้ายไป "บัตรที่หมดอายุ"
        // ถ้าไม่มีการตั้งค่า expirationDate ให้ตั้งเป็น 1 ปีจากวันนี้
        if (appleConfig.expirationDate) {
            try {
                const expDate = new Date(appleConfig.expirationDate);
                if (!isNaN(expDate.getTime())) {
                    passJson.expirationDate = expDate.toISOString();
                    console.log(`✅ expirationDate: ${passJson.expirationDate}`);
                } else {
                    console.warn(`⚠️ Invalid expirationDate: ${appleConfig.expirationDate}`);
                }
            } catch (e) {
                console.error(`❌ Error parsing expirationDate: ${e}`);
            }
        } else {
            // ✅ Default: ตั้ง expirationDate เป็น 1 ปีจากวันนี้ (เพื่อให้บัตรไม่หมดอายุเร็วเกินไป)
            const oneYearFromNow = new Date();
            oneYearFromNow.setFullYear(oneYearFromNow.getFullYear() + 1);
            passJson.expirationDate = oneYearFromNow.toISOString();
            console.log(`✅ expirationDate (default, 1 year from now): ${passJson.expirationDate}`);
        }

        if (appleConfig.eventLatitude && appleConfig.eventLongitude) {
            passJson.locations = [{
                latitude: parseFloat(appleConfig.eventLatitude),
                longitude: parseFloat(appleConfig.eventLongitude),
                relevantText: appleConfig.relevantText || undefined
            }];
        }

        // 6. Prepare Images
        // According to Apple Wallet specs:
        // - icon.png is optional (29x29pt @1x, @2x, @3x) - if not provided, logoText will be used
        // - logo.png is optional (max 160x50pt @1x, @2x, @3x)
        // - strip.png is optional for generic pass (375x98pt @1x, @2x, @3x) - displays as thumbnail

        console.log("Fetching images...");
        const logoUrl = appleConfig.logoUri;
        const iconUrl = appleConfig.iconUri;
        const stripUrl = appleConfig.stripImageUri;

        // ✅ เพิ่ม: Debug logging สำหรับ icon URL
        console.log('📷 Icon URL:', iconUrl || '(not configured - will use logoText)');
        console.log('📷 Logo URL:', logoUrl || '(not configured)');
        console.log('📷 Strip URL:', stripUrl || '(not configured)');

        const logoBuffer = await fetchImage(logoUrl);
        const iconBuffer = await fetchImage(iconUrl);
        const stripBuffer = await fetchImage(stripUrl);

        // ✅ เพิ่ม: Log ผลการ fetch images
        console.log('📷 === IMAGE FETCH RESULTS ===');
        console.log(`  - Icon: ${iconBuffer ? `✅ Fetched (${iconBuffer.byteLength} bytes)` : '❌ Not found or failed'}`);
        console.log(`  - Logo: ${logoBuffer ? `✅ Fetched (${logoBuffer.byteLength} bytes)` : '❌ Not found or failed'}`);
        console.log(`  - Strip: ${stripBuffer ? `✅ Fetched (${stripBuffer.byteLength} bytes)` : '❌ Not found or failed'}`);
        
        // ✅ เพิ่ม: Log รายละเอียด strip image
        if (stripBuffer) {
            console.log(`📷 Strip image details: ${stripBuffer.byteLength} bytes`);
            console.log(`📷 Strip image URL: ${stripUrl}`);
        } else if (stripUrl) {
            console.warn(`⚠️ Strip image URL configured but failed to fetch: ${stripUrl}`);
            console.warn(`⚠️ Please check if the URL is accessible and returns a valid image.`);
        } else {
            console.log('ℹ️ Strip image URL not configured');
        }

        // ✅ แก้ไข: icon.png เป็น optional - ถ้าไม่มีจะใช้ logoText แทน
        if (!iconBuffer) {
            console.warn('⚠️ Icon image not provided. Using logoText instead.');
            if (!appleConfig.logoText) {
                console.warn('⚠️ Warning: Neither icon image nor logoText is provided. Pass may not display icon correctly.');
            } else {
                console.log(`✅ Will use logoText: "${appleConfig.logoText}"`);
            }
        }

        // 7. Create Zip with manifest
        const zip = new JSZip();
        const manifest: Record<string, string> = {};

        // Add pass.json (always required)
        const passJsonString = JSON.stringify(passJson, null, 2); // Pretty print for debugging
        
        // ✅ เพิ่ม: Log pass.json เพื่อตรวจสอบว่า field ถูกเติมค่าถูกต้องหรือไม่
        console.log('📄 === PASS.JSON DEBUG ===');
        console.log('Pass JSON structure:', JSON.stringify(passJson, null, 2));
        
        // ✅ เพิ่ม: Validate pass.json structure
        const requiredFields = ['formatVersion', 'passTypeIdentifier', 'serialNumber', 'teamIdentifier', 'organizationName', 'description'];
        const missingFields = requiredFields.filter(field => !passJson[field]);
        if (missingFields.length > 0) {
            console.error('❌ Missing required fields in pass.json:', missingFields);
            return c.json({ 
                error: `Invalid pass structure: Missing required fields: ${missingFields.join(', ')}` 
            }, 500);
        }
        
        // ✅ เพิ่ม: Validate generic pass structure
        if (!passJson.generic || !Array.isArray(passJson.generic.primaryFields) || passJson.generic.primaryFields.length === 0) {
            console.error('❌ Invalid generic pass structure: primaryFields is required');
            return c.json({ 
                error: 'Invalid pass structure: generic.primaryFields is required and must have at least one field' 
            }, 500);
        }
        
        zip.file("pass.json", passJsonString);
        manifest["pass.json"] = createHash(passJsonString);

        // Add images with multiple resolutions
        // Icon is optional - only add if provided
        // ⚠️ สำคัญ: บาง iOS version ต้องการ icon.png แม้ว่าจะมี logoText แล้ว
        // ถ้าไม่มี icon.png ให้ใช้ logo.png เป็น fallback
        if (iconBuffer) {
            await createMultiResolutionImages(zip, manifest, iconBuffer, 'icon');
            console.log('✅ Icon image added to pass');
        } else if (logoBuffer) {
            // ✅ Fallback: ใช้ logo.png เป็น icon.png เพื่อให้ iOS บางเวอร์ชันยอมรับ
            console.log('⚠️ Icon image not provided - using logo.png as fallback icon');
            await createMultiResolutionImages(zip, manifest, logoBuffer, 'icon');
            console.log('✅ Logo image used as icon fallback');
        } else {
            console.log('ℹ️ Icon image not provided - using logoText instead');
            console.warn('⚠️ Warning: Some iOS versions may require icon.png. Consider adding an icon image.');
        }

        // Logo is optional but recommended
        if (logoBuffer) {
            await createMultiResolutionImages(zip, manifest, logoBuffer, 'logo');
            console.log('✅ Logo image added to pass');
        } else {
            console.log('ℹ️ Logo image not provided - using logoText instead');
        }

        // ✅ Strip is optional for generic pass (displays as thumbnail)
        // ✅ เพิ่ม: Log และเพิ่ม strip image เข้า ZIP
        // ⚠️ สำคัญ: สำหรับ generic pass type, strip image จะแสดงเป็น thumbnail ที่ด้านบนของ pass
        // ขนาดที่แนะนำ: 375x98pt @1x (1125x294px), 750x196pt @2x (1500x392px), 1125x294pt @3x (2250x588px)
        // ✅ สำหรับ generic pass type, อาจต้องใช้ thumbnail.png แทน strip.png
        if (stripBuffer) {
            console.log('📷 === ADDING STRIP IMAGE TO PASS ===');
            console.log(`📷 Strip buffer size: ${stripBuffer.byteLength} bytes`);
            
            // ✅ เพิ่ม strip.png สำหรับ generic pass type (อาจไม่แสดงในบาง iOS version)
            zip.file("strip.png", stripBuffer);
            manifest["strip.png"] = createHash(stripBuffer);
            console.log('  ✅ strip.png added to ZIP and manifest');

            // Add @2x and @3x versions if needed (using same image for now)
            zip.file("strip@2x.png", stripBuffer);
            manifest["strip@2x.png"] = createHash(stripBuffer);
            console.log('  ✅ strip@2x.png added to ZIP and manifest');

            zip.file("strip@3x.png", stripBuffer);
            manifest["strip@3x.png"] = createHash(stripBuffer);
            console.log('  ✅ strip@3x.png added to ZIP and manifest');
            
            // ✅ เพิ่ม thumbnail.png สำหรับ generic pass type (อาจแสดงได้ดีกว่า strip.png)
            // thumbnail.png จะแสดงเป็น thumbnail ที่ด้านบนของ pass สำหรับ generic pass type
            zip.file("thumbnail.png", stripBuffer);
            manifest["thumbnail.png"] = createHash(stripBuffer);
            console.log('  ✅ thumbnail.png added to ZIP and manifest (for generic pass type)');

            zip.file("thumbnail@2x.png", stripBuffer);
            manifest["thumbnail@2x.png"] = createHash(stripBuffer);
            console.log('  ✅ thumbnail@2x.png added to ZIP and manifest');

            zip.file("thumbnail@3x.png", stripBuffer);
            manifest["thumbnail@3x.png"] = createHash(stripBuffer);
            console.log('  ✅ thumbnail@3x.png added to ZIP and manifest');
            
            console.log('✅ Strip image added to pass successfully');
            console.log('📷 Note: For generic pass type, both strip.png and thumbnail.png are included');
            console.log('📷 thumbnail.png may display better than strip.png for generic pass type');
            console.log('📷 Recommended size: 375x98pt @1x (1125x294px for retina)');
        } else {
            console.log('ℹ️ Strip image not provided - skipping strip image');
            if (stripUrl) {
                console.warn(`⚠️ Warning: Strip image URL configured (${stripUrl}) but failed to fetch.`);
                console.warn(`⚠️ Please check if the URL is accessible and returns a valid PNG image.`);
            }
        }

        // 8. Create Manifest
        // manifest.json must contain SHA1 hash of ALL files in the pass (except manifest.json and signature itself)
        // Files must be sorted alphabetically in manifest
        const sortedManifest: Record<string, string> = {};
        Object.keys(manifest).sort().forEach(key => {
            sortedManifest[key] = manifest[key];
        });

        const manifestString = JSON.stringify(sortedManifest);
        zip.file("manifest.json", manifestString);

        console.log(`📋 Manifest contains ${Object.keys(sortedManifest).length} files`);
        console.log('📋 Manifest files:', Object.keys(sortedManifest).sort().join(', '));
        
        // ✅ เพิ่ม: Validate manifest structure
        // Note: signature should NOT be in manifest.json (it signs the manifest itself)
        const manifestRequiredFiles = ['pass.json'];
        const missingManifestFiles = manifestRequiredFiles.filter(file => !sortedManifest[file]);
        if (missingManifestFiles.length > 0) {
            console.error('❌ Missing required files in manifest:', missingManifestFiles);
            return c.json({ 
                error: `Invalid pass structure: Missing required files: ${missingManifestFiles.join(', ')}` 
            }, 500);
        }
        
        // Validate that signature will be added later (it's not in manifest by design)
        console.log('✅ Manifest validation passed (signature will be added separately)');
        
        // ✅ เพิ่ม: Warning ถ้าไม่มี icon (แม้ว่าจะเป็น optional แต่บางเวอร์ชัน iOS อาจต้องการ)
        if (!sortedManifest['icon.png']) {
            console.warn('⚠️ Warning: icon.png is missing from manifest. Some iOS versions may require it.');
            console.warn('⚠️ Consider adding icon.png or ensure logoText is set.');
        }

        // แทนที่ส่วน "9. Sign Manifest" ในโค้ดเดิม

        // 9. Sign Manifest
        try {
            const pki = forge.pki;
            let certificate, privateKey, wwdrCert;

            // ✅ เพิ่ม: Debug certificate loading
            console.log('🔍 === CERTIFICATE LOADING DEBUG ===');
            console.log(`📏 WWDR Raw Length: ${wwdrPemRaw.length} chars`);
            console.log(`📏 Signer Cert Raw Length: ${signerCertPemRaw.length} chars`);
            console.log(`📏 Signer Key Raw Length: ${signerKeyPemRaw.length} chars`);

            // Preview first 100 chars of each (ตรวจสอบว่ามี BEGIN header ไหม)
            console.log(`📄 WWDR Preview: ${wwdrPemRaw.substring(0, 100)}...`);
            console.log(`📄 Signer Cert Preview: ${signerCertPemRaw.substring(0, 100)}...`);
            console.log(`📄 Signer Key Preview: ${signerKeyPemRaw.substring(0, 100)}...`);

            // ตรวจสอบว่ามี header/footer ครบไหม
            const checkPemFormat = (pem: string, name: string) => {
                const hasBegin = pem.includes('-----BEGIN');
                const hasEnd = pem.includes('-----END');
                console.log(`🔍 ${name}:`, {
                    hasBegin,
                    hasEnd,
                    hasNewlines: pem.includes('\n'),
                    hasBackslashN: pem.includes('\\n'),
                    hasQuotes: pem.includes('"')
                });
            };

            checkPemFormat(wwdrPemRaw, 'WWDR');
            checkPemFormat(signerCertPemRaw, 'Signer Cert');
            checkPemFormat(signerKeyPemRaw, 'Signer Key');

            console.log('🔍 === PARSING CERTIFICATES ===');

            // ✅ Parse Signer Certificate
            try {
                console.log('🔄 Parsing Signer Certificate...');
                const cleanedSignerCert = cleanPem(signerCertPemRaw);
                console.log(`✅ Cleaned Signer Cert (first 100 chars): ${cleanedSignerCert.substring(0, 100)}...`);

                certificate = parseCertFallback(cleanedSignerCert);

                const signerCN = certificate.subject.attributes
                    .find((attr: any) => attr.shortName === 'CN')?.value || '';
                console.log(`✅ Signer Certificate parsed: CN="${signerCN}"`);

            } catch (e) {
                console.error('❌ FAILED to parse Signer Certificate');
                console.error('Error:', (e as Error).message);
                console.error('Stack:', (e as Error).stack);
                throw new Error(`Failed to parse Signer Cert: ${(e as Error).message}`);
            }

            // ✅ Parse Private Key
            try {
                console.log('🔄 Parsing Private Key...');
                const cleanedKey = cleanPem(signerKeyPemRaw);
                console.log(`✅ Cleaned Private Key (first 100 chars): ${cleanedKey.substring(0, 100)}...`);

                privateKey = pki.privateKeyFromPem(cleanedKey);
                console.log('✅ Private Key parsed successfully');

            } catch (e) {
                console.error('❌ FAILED to parse Private Key');
                console.error('Error:', (e as Error).message);
                console.error('Stack:', (e as Error).stack);
                throw new Error(`Failed to parse Private Key: ${(e as Error).message}`);
            }

            // ✅ Parse WWDR Certificate
            try {
                console.log('🔄 Parsing WWDR Certificate...');
                const cleanedWwdr = cleanPem(wwdrPemRaw);
                console.log(`✅ Cleaned WWDR (first 100 chars): ${cleanedWwdr.substring(0, 100)}...`);

                wwdrCert = parseCertFallback(cleanedWwdr);

                // ดึงข้อมูล Subject ทั้งหมด
                const wwdrSubjectStr = wwdrCert.subject.attributes
                    .map((attr: any) => `${attr.shortName}=${attr.value}`)
                    .join(', ');

                console.log(`📜 WWDR Certificate Subject: ${wwdrSubjectStr}`);

                // ตรวจสอบ CN (Common Name)
                const wwdrCN = wwdrCert.subject.attributes
                    .find((attr: any) => attr.shortName === 'CN')?.value || '';

                if (!wwdrCN.includes('Worldwide Developer Relations')) {
                    throw new Error(
                        `❌ Invalid WWDR Certificate. CN must contain "Worldwide Developer Relations". ` +
                        `Found: ${wwdrCN}`
                    );
                }

                // ตรวจสอบ G4
                const wwdrOU = wwdrCert.subject.attributes
                    .find((attr: any) => attr.shortName === 'OU')?.value || '';

                console.log(`📋 WWDR OU: ${wwdrOU || 'Not found in OU field'}`);

                const hasG4 = wwdrOU.includes('G4') || wwdrCN.includes('G4');

                if (!hasG4) {
                    throw new Error(
                        `❌ WWDR Certificate is NOT G4 (OU: ${wwdrOU}, CN: ${wwdrCN}). ` +
                        `Apple Wallet REQUIRES G4 certificate. ` +
                        `Download "Worldwide Developer Relations - G4 (Expiring 12/10/2030)" from: ` +
                        `https://www.apple.com/certificateauthority/`
                    );
                }

                // ตรวจสอบ Expiration Date
                const notAfter = wwdrCert.validity.notAfter;
                const expiryYear = notAfter.getFullYear();

                console.log(`📅 WWDR Certificate Expires: ${notAfter.toISOString()}`);

                if (expiryYear !== 2030) {
                    console.warn(`⚠️ Warning: WWDR expiry year is ${expiryYear}, expected 2030 for G4`);
                }

                // ตรวจสอบว่าเป็น RSA
                const publicKey = wwdrCert.publicKey;
                if (!(publicKey as any).n) {
                    throw new Error(
                        `❌ WWDR Certificate uses wrong algorithm (ECC/ECDSA). ` +
                        `Must be RSA. You may have downloaded G6 instead of G4.`
                    );
                }

                console.log(`✅ Algorithm: RSA-${(publicKey as any).n.bitLength()} bit`);

                // ตรวจสอบ Certificate Chain Trust
                const signerAuthKeyId = certificate.extensions?.find(
                    (ext: any) => ext.name === 'authorityKeyIdentifier'
                )?.value;

                const wwdrSubjectKeyId = wwdrCert.extensions?.find(
                    (ext: any) => ext.name === 'subjectKeyIdentifier'
                )?.value;

                console.log('🔗 Signer Authority Key ID:', signerAuthKeyId ? 'Present' : 'Missing');
                console.log('🔗 WWDR Subject Key ID:', wwdrSubjectKeyId ? 'Present' : 'Missing');

                console.log('✅ WWDR G4 Certificate validated successfully');

            } catch (e) {
                console.error('❌ FAILED to parse WWDR Certificate');
                console.error('Error:', (e as Error).message);
                console.error('Stack:', (e as Error).stack);

                const msg = (e as Error).message;
                if (msg.includes('❌')) {
                    throw e; // Re-throw our custom validation errors
                }
                throw new Error(`Failed to parse/validate WWDR Cert: ${msg}`);
            }

            console.log('🔍 === ALL CERTIFICATES PARSED SUCCESSFULLY ===');

            // Sign manifest.json according to Apple Wallet PKCS#7 specification
            console.log('🔏 Creating PKCS#7 signature...');
            const p7 = forge.pkcs7.createSignedData();
            p7.content = forge.util.createBuffer(manifestString, 'utf8');

            // Add certificates in correct order
            p7.addCertificate(certificate); // Signer certificate first
            p7.addCertificate(wwdrCert);    // WWDR certificate second

            // Add signer with required authenticated attributes
            p7.addSigner({
                key: privateKey,
                certificate: certificate,
                digestAlgorithm: forge.pki.oids.sha1,
                authenticatedAttributes: [{
                    type: forge.pki.oids.contentType,
                    value: forge.pki.oids.data
                }, {
                    type: forge.pki.oids.messageDigest,
                }, {
                    type: forge.pki.oids.signingTime,
                }]
            });

            // Sign with detached signature
            p7.sign({ detached: true });

            // Convert to DER format
            const asn1 = p7.toAsn1();
            const der = forge.asn1.toDer(asn1);

            let derBytes: string;

            try {
                const bytesResult = der.getBytes();
                console.log(`🔍 der.getBytes() returned type: ${typeof bytesResult}`);

                if (typeof bytesResult === 'string') {
                    derBytes = bytesResult;
                } else {
                    console.warn('⚠️ der.getBytes() did not return string, attempting conversion...');
                    derBytes = String(bytesResult);
                }
            } catch (err) {
                console.error('❌ Error getting bytes from der:', err);
                throw new Error(`Failed to extract DER bytes: ${(err as Error).message}`);
            }

            if (!derBytes || typeof derBytes.charCodeAt !== 'function') {
                throw new Error(`Invalid DER bytes type: ${typeof derBytes}, has charCodeAt: ${typeof derBytes?.charCodeAt}`);
            }

            // Convert to Uint8Array
            const signatureBuffer = new Uint8Array(derBytes.length);
            for (let i = 0; i < derBytes.length; i++) {
                const charCode = derBytes.charCodeAt(i);
                signatureBuffer[i] = charCode & 0xFF;
            }

            // Add signature file to zip
            zip.file("signature", signatureBuffer);

            console.log(`✅ Signature created: ${signatureBuffer.length} bytes`);
            console.log('✅ Signature added to ZIP file');
            console.log('✅ Pass signed successfully');

        } catch (err) {
            console.error("❌ === SIGNING ERROR ===");
            console.error("Error message:", (err as Error).message);
            console.error("Error stack:", (err as Error).stack);
            return c.json({ error: `Pass Signing Failed: ${(err as Error).message}` }, 500);
        }

        // 10. Generate Zip Content
        // Important: ZIP must be created with proper compression and structure
        // manifest.json must be added before signature
        console.log('📦 Starting ZIP file generation...');
        console.log(`📦 ZIP files count: ${Object.keys(zip.files || {}).length}`);
        
        const content = await zip.generateAsync({
            type: "uint8array",
            compression: "DEFLATE",
            compressionOptions: { level: 6 } // Standard compression level
        });

        console.log(`✅ ZIP file generated successfully (${content.length} bytes)`);
        console.log(`✅ PKPass file generated successfully (${content.length} bytes)`);
        
        // ✅ เพิ่ม: Final validation summary
        console.log('📊 === PASS GENERATION SUMMARY ===');
        console.log(`✅ Pass Type: generic`);
        console.log(`✅ Serial Number: ${passJson.serialNumber}`);
        console.log(`✅ Organization: ${passJson.organizationName}`);
        console.log(`✅ Primary Fields: ${passJson.generic.primaryFields.length}`);
        console.log(`✅ Has Icon: ${!!sortedManifest['icon.png']}`);
        console.log(`✅ Has Logo: ${!!sortedManifest['logo.png']}`);
        console.log(`✅ Has Strip: ${!!sortedManifest['strip.png']}`);
        if (sortedManifest['strip.png']) {
            console.log(`  📷 Strip image files: strip.png, strip@2x.png, strip@3x.png`);
            console.log(`  📷 Thumbnail image files: thumbnail.png, thumbnail@2x.png, thumbnail@3x.png`);
            console.log(`  📷 Strip image URL: ${stripUrl || 'N/A'}`);
            console.log(`  📷 Note: For generic pass type, strip image displays as thumbnail at the top`);
            console.log(`  📷 Recommended size: 375x98pt @1x (1125x294px for retina)`);
        } else {
            console.log(`  ⚠️ Strip image not included in pass`);
            if (stripUrl) {
                console.log(`  ⚠️ Strip URL was configured: ${stripUrl}`);
                console.log(`  ⚠️ But failed to fetch or add to ZIP`);
            }
        }
        console.log(`✅ Has LogoText: ${!!passJson.logoText}`);
        console.log(`✅ Files in manifest.json: ${Object.keys(sortedManifest).length}`);
        console.log(`✅ Total files in ZIP: ${Object.keys(sortedManifest).length + 2} (manifest.json + signature + ${Object.keys(sortedManifest).length} content files)`);
        console.log(`✅ ZIP file size: ${content.length} bytes`);

        // ✅ Generate safe filename (no spaces, URL-safe)
        const safeFilename = `pass_${runnerId}_${Date.now()}.pkpass`;

        return new Response(content, {
            headers: {
                "Content-Type": "application/vnd.apple.pkpass",
                "Content-Disposition": `attachment; filename="${safeFilename}"`,
                "Content-Length": content.length.toString(),
                // ✅ เพิ่ม: CORS headers สำหรับ Safari
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
                "Access-Control-Allow-Headers": "Content-Type, Authorization"
            }
        });

    } catch (error) {
        console.error("Critical Error:", error);
        return c.json({ error: (error as Error).message }, 500);
    }
};

app.all('*', handleRequest);

serve(app.fetch);