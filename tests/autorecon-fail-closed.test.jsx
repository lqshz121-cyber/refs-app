import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {AutoBankRec,CheckMgmt} from '../src/module-wbs.jsx';

let failed=0;
const expect=(name,value)=>{console.log(value?'PASS':'FAIL',name);if(!value)failed++;};
const html=renderToStaticMarkup(<AutoBankRec ctx={{actions:{},toast:()=>{}}}/>);
const checkHtml=renderToStaticMarkup(<CheckMgmt ctx={{actions:{},toast:()=>{}}}/>);

expect('states the authoritative API boundary',html.includes('AUTOREC_API_UNAVAILABLE'));
expect('does not render fabricated posted journal numbers',!html.includes('20260731000041')&&!html.includes('20260731000042'));
expect('does not claim an Incur created a journal entry',!html.includes('已 Incur:生成银行流水 JE'));
expect('does not claim a sample check was voided and posted',!checkHtml.includes('已作废,冲销分录已过账'));

if(failed)process.exitCode=1;
