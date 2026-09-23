'use strict';
const crypto = require('node:crypto');
const ALPHABET='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function base32Encode(buf){let bits=0,value=0,out='';for(const byte of buf){value=(value<<8)|byte;bits+=8;while(bits>=5){out+=ALPHABET[(value>>>(bits-5))&31];bits-=5;}}if(bits>0)out+=ALPHABET[(value<<(5-bits))&31];return out;}
function base32Decode(text){let bits=0,value=0,out=[];for(const ch of String(text||'').toUpperCase().replace(/=|\s/g,'')){const idx=ALPHABET.indexOf(ch);if(idx<0)throw new Error('TOTP secret tidak valid.');value=(value<<5)|idx;bits+=5;if(bits>=8){out.push((value>>>(bits-8))&255);bits-=8;}}return Buffer.from(out);}
function generateSecret(){return base32Encode(crypto.randomBytes(20));}
function code(secret,time=Date.now(),step=30,digits=6){const counter=Math.floor(time/1000/step);const msg=Buffer.alloc(8);msg.writeBigUInt64BE(BigInt(counter));const h=crypto.createHmac('sha1',base32Decode(secret)).update(msg).digest();const off=h[h.length-1]&15;const bin=((h[off]&127)<<24)|(h[off+1]<<16)|(h[off+2]<<8)|h[off+3];return String(bin%(10**digits)).padStart(digits,'0');}
function verify(secret,input,{window=1}={}){const candidate=String(input||'').replace(/\s/g,'');if(!/^\d{6}$/.test(candidate))return false;for(let i=-window;i<=window;i++){const expected=code(secret,Date.now()+i*30000);const a=Buffer.from(expected),b=Buffer.from(candidate);if(a.length===b.length&&crypto.timingSafeEqual(a,b))return true;}return false;}
function otpauth({secret,email,issuer='Nusantara HostPanel'}){const label=`${issuer}:${email}`;return `otpauth://totp/${encodeURIComponent(label)}?secret=${encodeURIComponent(secret)}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;}
function recoveryCodes(count=10){return Array.from({length:count},()=>`${crypto.randomBytes(3).toString('hex')}-${crypto.randomBytes(3).toString('hex')}`);}
module.exports={generateSecret,verify,otpauth,recoveryCodes};
