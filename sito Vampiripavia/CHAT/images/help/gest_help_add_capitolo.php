<?
	include ("../db_connect.php");
	
	$capitolo = $_POST['capitolo'];	
	
	OpenConnection();

	$sql = "";
	$sql .= "INSERT INTO help_capitoli(titolo_capitolo) ";
	$sql .= "VALUES('".$capitolo."')";
	
	$query = mysql_query($sql);

	CloseConnection();		
	
	header("Location: gest_help.php");
?>
