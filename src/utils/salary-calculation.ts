export type SalaryLine={label:string;amount:number;direction?:'ADD'|'SUBTRACT'};
export function calculateNetSalary(grossBase:number,adjustments:SalaryLine[],deductions:SalaryLine[]){
 if(!Number.isFinite(grossBase)||grossBase<0||[...adjustments,...deductions].some(x=>!Number.isFinite(x.amount)||x.amount<0))throw new RangeError('Salary amounts must be finite and nonnegative');
 const additions=adjustments.reduce((sum,x)=>sum+(x.direction==='SUBTRACT'?-x.amount:x.amount),0);
 const deductionsTotal=deductions.reduce((sum,x)=>sum+x.amount,0);
 const netPayable=Math.round((grossBase+additions-deductionsTotal)*100)/100;
 if(netPayable<0)throw new RangeError('Salary deductions exceed gross pay and adjustments');
 return {grossBase,adjustments,deductions,netPayable};
}
