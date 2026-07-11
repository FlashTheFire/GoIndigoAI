import pytest
from app.parsers import parse_flight_response
from app.exceptions import ValidationError

def test_parse_valid_double_encoded_json():
    # The API sometimes returns JSON encoded inside a string
    raw_response = '"[{\\"CIID\\": 123, \\"flightInfo\\": [{\\"Flt_No\\": 6092}]}]"'
    result = parse_flight_response(raw_response)
    assert len(result) == 1
    assert result[0].CIID == 123
    assert len(result[0].flightInfo) == 1
    assert result[0].flightInfo[0].Flt_No == 6092

def test_parse_missing_fields_fail_safely():
    # Missing CIID, but it's optional so it should parse safely
    raw_response = '[{"GroupId": 4, "flightInfo": [{"Dep": "DEL"}]}]'
    result = parse_flight_response(raw_response)
    assert len(result) == 1
    assert result[0].CIID is None
    assert result[0].flightInfo[0].Dep == "DEL"

def test_parse_invalid_json():
    with pytest.raises(ValidationError):
        parse_flight_response('<!DOCTYPE html><html>')

def test_parse_cart_allocations():
    from unittest.mock import MagicMock
    from app.http_client import APIClient
    
    # Mock httpx.Client response
    mock_client = MagicMock()
    html_data = """
    <input name="[0].CartTypeModelList[0].CartType" value="L1" />
    <input name="[0].CartTypeModelList[0].M_CartId" value="04929" />
    <input name="[0].AssetTypeModelList[0].CartType" value="R1" />
    <input name="[0].AssetTypeModelList[0].AssetId" value="21942" />
    """
    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.text = html_data
    mock_client.request.return_value = mock_response
    
    client = APIClient()
    client.client = mock_client
    
    carts, drawers = client.get_cart_allocations(
        station="DEL", date="2026-06-04", flight_number="6092", caterer="OFS", aircraft_id=4
    )
    
    assert carts == {"L1": "04929"}
    assert drawers == {"R1": "RET21942"}


def test_parse_cart_allocation_html():
    from app.web_server import parse_cart_allocation_html
    
    html_data = """
    <table>
        <tr>
            <td>04/06/2026</td>
            <td>6092</td>
            <td>OFS</td>
            <td>DEL</td>
            <td>IXJ</td>
            <td>08:00</td>
            <td>09:20</td>
        </tr>
    </table>
    <input name="[0].CartTypeModelList[0].T_CIId" value="12605108" />
    <input name="[0].CartTypeModelList[0].CartType" value="L1" />
    <input name="[0].CartTypeModelList[0].M_CartId" value="04929" />
    
    <input name="[0].AssetTypeModelList[0].T_CIId" value="12605111" />
    <input name="[0].AssetTypeModelList[0].CartType" value="R1" />
    <input name="[0].AssetTypeModelList[0].AssetId" value="21942" />
    """
    
    res = parse_cart_allocation_html(html_data)
    
    assert res["flight_date"] == "04/06/2026"
    assert res["flight_number"] == "6092"
    assert res["caterer"] == "OFS"
    assert res["dep"] == "DEL"
    assert res["arr"] == "IXJ"
    assert res["std"] == "08:00"
    assert res["sta"] == "09:20"
    
    assert len(res["carts"]) == 1
    assert res["carts"][0]["t_ciid"] == "12605108"
    assert res["carts"][0]["type"] == "L1"
    assert res["carts"][0]["cart_id"] == "04929"
    
    assert len(res["devices"]) == 1
    assert res["devices"][0]["t_ciid"] == "12605111"
    assert res["devices"][0]["type"] == "R1"
    assert res["devices"][0]["asset_id"] == "21942"

def test_parse_aliases_and_normalize():
    raw_response = '[{"GroupId": 4, "flightInfo": [{"Flt_No": 382, "SeqNo": 2, "IsTopup": "Yes", "Cater_Code": "OFS2", "AircraftType": "A32132P"}]}]'
    result = parse_flight_response(raw_response)
    assert len(result) == 1
    assert len(result[0].flightInfo) == 1
    flight = result[0].flightInfo[0]
    assert flight.Seq == 2
    assert flight.IsTopUp == "Yes"
    assert flight.Caterer_Code == "OFS2"
    
def test_get_aircraft_type_id():
    from app.models import get_aircraft_type_id
    assert get_aircraft_type_id("A320") == 1
    assert get_aircraft_type_id("A321") == 4
    assert get_aircraft_type_id("A32132P") == 9
    assert get_aircraft_type_id("A32032W") == 7
    assert get_aircraft_type_id("789") == 11
    assert get_aircraft_type_id("UnknownType") is None


def test_parse_text_table_bulk():
    from app.bulk_parser import parse_text_table
    
    table_text = """05.06.2026 MPOS ALLOCATION DAY SHIFT

| SNO. | FLIGHT NO | L1 |    R1 |    R2 |    R3 |    R4 |
| ---: | --------: | -- | ----: | ----: | ----: | ----: |
|   40 |      2276 |    | 20270 |       |       | 20249 |
|   41 |      2316 |    | 22850 |       | 21139 | 22847 |
|   42 |      2403 |    | 22616 |       | 24006 | 24189 |
|   43 |      5014 |    | 22626 |       | 23467 | 23487 |
|   44 |      5023 |    | 22807 | 24242 |       |       |
|   45 |      5161 |    | 23167 |       | 22141 | 21229 |
|   46 |      5138 |    | 22104 | 20894 |       |       |
|   47 |      5001 |    | 23724 |       |       | 24280 |
|   48 |      1161 |    | 21425 | 22740 |       |       |
|   49 |       329 |    | 23750 |       |       | 21757 |
|   50 |       811 |    | 21624 |       |       | 23421 |
|   51 |      6265 |    | 23905 | 22280 |       |       |
|   52 |       950 |    | 20611 |       |       | 22388 |
|   53 |       354 |    | 21982 |       |       | 20445 |
|   54 |           |    |       |       |       |       |
|   55 |           |    |       |       |       |       |
|   56 |           |    |       |       |       |       |
|   57 |           |    |       |       |       |       |
"""
    
    parsed = parse_text_table(table_text)
    assert parsed.shift_date == "2026-06-05"
    assert parsed.shift_label == "DAY"
    assert len(parsed.rows) == 14
    
    # Check flight 2276
    row_2276 = next(r for r in parsed.rows if r.flight_no == "2276")
    assert row_2276.sno == 40
    assert row_2276.positions == {'L1': '', 'R1': '20270', 'R2': '', 'R3': '', 'R4': '20249'}
    
    # Check flight 5023
    row_5023 = next(r for r in parsed.rows if r.flight_no == "5023")
    assert row_5023.sno == 44
    assert row_5023.positions == {'L1': '', 'R1': '22807', 'R2': '24242', 'R3': '', 'R4': ''}


def test_build_allocations_fallback_r2_r4():
    from app.bulk_processor import _build_allocations
    
    # Target positions where R4 is given, but R2 is not
    positions = {"R2": "", "R4": "20249", "L1": "11111"}
    
    # Devices return only R2, L1 (so R4 is NOT available physically)
    devices = [
        {"type": "R2", "t_ciid": "123"},
        {"type": "L1", "t_ciid": "456"}
    ]
    
    allocations = _build_allocations(devices, positions)
    
    # Expect: R4 value '20249' should redirect to R2 physical position
    r2_alloc = next((a for a in allocations if a["cart_type"] == "R2"), None)
    assert r2_alloc is not None
    assert r2_alloc["asset_number"] == "RET20249"
    assert r2_alloc["t_ciid"] == "123"
    
    l1_alloc = next((a for a in allocations if a["cart_type"] == "L1"), None)
    assert l1_alloc is not None
    assert l1_alloc["asset_number"] == "RET11111"
    
    # Make sure R4 is not in allocations because it's not physically present
    r4_alloc = next((a for a in allocations if a["cart_type"] == "R4"), None)
    assert r4_alloc is None

    # Test swap R2 target to R4 physically present
    positions_2 = {"R2": "20894", "R4": "", "L1": "11111"}
    devices_2 = [
        {"type": "R4", "t_ciid": "789"},
        {"type": "L1", "t_ciid": "456"}
    ]
    allocations_2 = _build_allocations(devices_2, positions_2)
    
    r4_alloc_2 = next((a for a in allocations_2 if a["cart_type"] == "R4"), None)
    assert r4_alloc_2 is not None
    assert r4_alloc_2["asset_number"] == "RET20894"
    assert r4_alloc_2["t_ciid"] == "789"


