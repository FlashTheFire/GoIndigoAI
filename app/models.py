from typing import List, Optional, Any
from pydantic import BaseModel, Field

class FlightInfoTemplate(BaseModel):
    MasterTemplateId: Optional[int] = None
    AircraftClass: Optional[str] = None
    Percentage: Optional[float] = None
    model_config = {"extra": "ignore"}

# Official aircraft type mapping from https://cops.goindigo.in/AircraftType/GetAircraftType?id=0
AIRCRAFT_TYPE_MAP = {
    "A320": 1,
    "ATR": 2,
    "A321": 4,
    "77W77E": 5,
    "77W777": 6,
    "A32032W": 7,
    "7377M8": 8,
    "A32132P": 9,
    "738": 10,
    "789": 11,
    "77W77B": 12,
    "A32132Y(XLR)": 14,
    "A32132Z": 15,
    "A32032R": 16,
    "A32132Y(Stretch)": 17,
    "A32132Y(Eco)": 18
}

def get_aircraft_type_id(type_name: Optional[str], default_id: Optional[int] = None) -> Optional[int]:
    if not type_name:
        return default_id
    
    # Try exact match first
    type_name_clean = type_name.strip()
    if type_name_clean in AIRCRAFT_TYPE_MAP:
        return AIRCRAFT_TYPE_MAP[type_name_clean]
        
    # Case-insensitive match
    type_name_upper = type_name_clean.upper()
    for k, v in AIRCRAFT_TYPE_MAP.items():
        if k.upper() == type_name_upper:
            return v
            
    # Partial matches or heuristics
    if "A321" in type_name_upper:
        if "32P" in type_name_upper:
            return 9
        elif "XLR" in type_name_upper:
            return 14
        elif "STRETCH" in type_name_upper:
            return 17
        elif "ECO" in type_name_upper:
            return 18
        elif "32Z" in type_name_upper:
            return 15
        return 4
    if "A320" in type_name_upper:
        if "32W" in type_name_upper:
            return 7
        if "32R" in type_name_upper:
            return 16
        return 1
    if "ATR" in type_name_upper:
        return 2
    if "77W" in type_name_upper or "777" in type_name_upper:
        if "77E" in type_name_upper:
            return 5
        if "77B" in type_name_upper:
            return 12
        return 6
    if "789" in type_name_upper or "787" in type_name_upper:
        return 11
    if "737" in type_name_upper or "7M8" in type_name_upper:
        return 8
    if "738" in type_name_upper:
        return 10
        
    return default_id

class FlightInfo(BaseModel):
    TxnId: Optional[int] = None
    RouteNo: Optional[int] = None
    GroupId: Optional[int] = None
    Flt_Dt: Optional[str] = None
    Dep: Optional[str] = None
    Arr: Optional[str] = None
    Flt_No: Optional[int] = None
    STD: Optional[str] = None
    STA: Optional[str] = None
    FlightType: Optional[str] = None
    AircraftType: Optional[str] = None
    Seq: Optional[int] = Field(alias="SeqNo", default=None)
    IsTopUp: Optional[Any] = Field(alias="IsTopup", default=None)
    Caterer_Code: Optional[str] = Field(alias="Cater_Code", default=None)
    Category: Optional[Any] = None
    AircraftTypeId: Optional[int] = None
    AircraftID: Optional[int] = None
    ACREGID: Optional[str] = None
    STC: Optional[str] = None
    carts: Optional[dict] = Field(default_factory=dict)
    drawers: Optional[dict] = Field(default_factory=dict)
    flight_info_template: Optional[List[FlightInfoTemplate]] = Field(alias="FlightInfoTemplate", default_factory=list)
    model_config = {"extra": "ignore", "populate_by_name": True}

class RouteGroup(BaseModel):
    CIID: Optional[int] = None
    GroupId: Optional[int] = None
    RouteNo: Optional[int] = None
    flightInfo: Optional[List[FlightInfo]] = Field(default_factory=list)
    model_config = {"extra": "ignore"}

