import pytest
from app.workflow import execute_business_rules
from app.models import RouteGroup, FlightInfo

def test_execute_business_rules(caplog):
    # Setup test data
    flight = FlightInfo(Flt_No=101, Dep="DEL", Arr="BOM", STD="05:30")
    group = RouteGroup(CIID=1, flightInfo=[flight])
    
    # Run
    caplog.set_level("INFO")
    execute_business_rules([group])
    
    # Assert
    assert "Early flight identified: 101" in caplog.text
    assert "Workflow completed. Total flights processed: 1" in caplog.text
