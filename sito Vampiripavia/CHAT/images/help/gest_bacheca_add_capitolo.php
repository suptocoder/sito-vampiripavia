<?
	include ("../db_connect.php");
	
	$capitolo = $_POST['capitolo'];	
	
	OpenConnection();

	$sql = "";
	$sql .= "INSERT INTO bacheca_capitoli(titolo_capitolo) ";
	$sql .= "VALUES('".$capitolo."')";
	
	$query = mysql_query($sql);

	CloseConnection();		
	
	header("Location: gest_bacheca.php");
?>
