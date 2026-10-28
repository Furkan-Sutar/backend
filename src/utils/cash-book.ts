type BookMovement={direction:'INFLOW'|'OUTFLOW';category:string;amount:number};
export function calculateCashBook(openingBalance:number,transactions:BookMovement[]){
 const inflow=transactions.filter(x=>x.direction==='INFLOW').reduce((s,x)=>s+x.amount,0);
 const outflow=transactions.filter(x=>x.direction==='OUTFLOW').reduce((s,x)=>s+x.amount,0);
 const sum=(category:string,direction:'INFLOW'|'OUTFLOW')=>transactions.filter(x=>x.category===category&&x.direction===direction).reduce((s,x)=>s+x.amount,0);
 return {openingBalance,inflow,outflow,closingBalance:openingBalance+inflow-outflow,breakdown:{collections:sum('COLLECTION','INFLOW'),collectionReversals:sum('COLLECTION_REVERSAL','OUTFLOW'),refunds:sum('REFUND','OUTFLOW'),expenses:sum('EXPENSE','OUTFLOW'),transfersIn:sum('TRANSFER','INFLOW'),transfersOut:sum('TRANSFER','OUTFLOW'),adjustmentIn:sum('ADJUSTMENT','INFLOW'),adjustmentOut:sum('ADJUSTMENT','OUTFLOW')}};
}
